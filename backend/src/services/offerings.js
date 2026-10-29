import { DEFAULT_TERM_ID } from '../constants/term.js';
import Course from '../models/Course.js';
import CourseOffering from '../models/CourseOffering.js';
import Professor from '../models/Professor.js';
import ProfessorCapacity from '../models/ProfessorCapacity.js';
import Registration from '../models/Registration.js';
import Student from '../models/Student.js';
import { getLiveSeatUsageMap } from './seatStatus.js';
import { inTerm } from './enrolment.js';

function seatsUsedFor(liveUsage, professorId, courseId) {
  return liveUsage[`${professorId}|${courseId}`] || 0;
}

/**
 * Offerings + per-offering status for a single student.
 * Returns rows of { offering, course, selected, allotted, registration }.
 */
export async function offeringsForStudent(studentId, termId = DEFAULT_TERM_ID) {
  const student = inTerm(await Student.findOne({ studentId }).lean(), termId);
  if (!student) return [];

  const [offerings, regs] = await Promise.all([
    CourseOffering.find({ termId, batchId: student.batchId }).lean(),
    Registration.find({ termId, studentId }).lean(),
  ]);
  const regByCourse = Object.fromEntries(regs.map((r) => [r.courseId, r]));

  const courseIds = offerings.map((o) => o.courseId);
  const courses = await Course.find({ courseId: { $in: courseIds } }).lean();
  const courseById = Object.fromEntries(courses.map((c) => [c.courseId, c]));

  return offerings.map((o) => {
    const course = courseById[o.courseId];
    const reg = regByCourse[o.courseId];
    return {
      offering: o,
      course,
      selected: Boolean(reg),
      registration: reg || null,
    };
  });
}

/**
 * Eligible professors for a given course in a term with live seat counts.
 * Returns [{ professorId, name, maxStudents, seatsUsed, seatsRemaining }]
 */
export async function professorsForCourse(courseId, termId = DEFAULT_TERM_ID) {
  const caps = await ProfessorCapacity.find({ courseId, termId }).lean();
  if (caps.length === 0) return [];
  const liveUsage = await getLiveSeatUsageMap(termId);
  const profs = await Professor.find({ professorId: { $in: caps.map((c) => c.professorId) } }).lean();
  const profById = Object.fromEntries(profs.map((p) => [p.professorId, p]));
  return caps
    .map((c) => {
      const used = seatsUsedFor(liveUsage, c.professorId, c.courseId);
      return {
        professorId: c.professorId,
        name: profById[c.professorId]?.name || c.professorId,
        department: profById[c.professorId]?.department,
        maxStudents: c.maxStudents,
        seatsUsed: used,
        seatsRemaining: Math.max(0, c.maxStudents - used),
      };
    })
    .sort((a, b) => b.seatsRemaining - a.seatsRemaining);
}
