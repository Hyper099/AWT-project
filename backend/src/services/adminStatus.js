import { DEFAULT_TERM_ID } from '../constants/term.js';
import Batch from '../models/Batch.js';
import Course from '../models/Course.js';
import CourseOffering from '../models/CourseOffering.js';
import Professor from '../models/Professor.js';
import ProfessorCapacity from '../models/ProfessorCapacity.js';
import Registration from '../models/Registration.js';
import Semester from '../models/Semester.js';
import Student from '../models/Student.js';
import Term from '../models/Term.js';
import TimetableEntry from '../models/TimetableEntry.js';
import { getLiveSeatUsageMap } from './seatStatus.js';
import { programmeProgress } from './programme.js';
import { studentsInTerm } from './enrolment.js';

/**
 * Cohort status: per-student selection completeness + professor seat status.
 * `batchId` and `semester` are optional filters; default scope is the whole term.
 */
export async function cohortStatus({ termId = DEFAULT_TERM_ID, batchId = null, semester = null } = {}) {
  const [students, offerings, regs, allCaps, entries, term, professors, semCourses] = await Promise.all([
    studentsInTerm(termId, { semester, batchId }),
    CourseOffering.find({ termId }).lean(),
    Registration.find({ termId }).lean(),
    ProfessorCapacity.find({ termId }).lean(),
    TimetableEntry.find({ termId }).lean(),
    Term.findOne({ termId }).lean(),
    Professor.find().lean(),
    semester ? Course.find({ semester: Number(semester) }, { courseId: 1 }).lean() : null,
  ]);
  // Seat table follows the semester filter; instructors teach across semesters.
  const semCourseIds = semCourses && new Set(semCourses.map((c) => c.courseId));
  const caps = semCourseIds ? allCaps.filter((c) => semCourseIds.has(c.courseId)) : allCaps;
  const liveUsage = await getLiveSeatUsageMap(termId);

  const offeringsByBatch = {};
  for (const o of offerings) (offeringsByBatch[o.batchId] ||= []).push(o);
  const regsByStudent = {};
  for (const r of regs) (regsByStudent[r.studentId] ||= []).push(r);

  let fullySelected = 0;
  let partial = 0;
  let none = 0;
  const byBatch = {};

  for (const s of students) {
    const batchOfferings = offeringsByBatch[s.batchId] || [];
    const studentRegs = regsByStudent[s.studentId] || [];
    const progress = programmeProgress(batchOfferings, studentRegs);
    let bucket;
    if (batchOfferings.length === 0 || studentRegs.length === 0) bucket = 'none';
    else if (progress.complete && progress.conflicts.length === 0) bucket = 'full';
    else bucket = 'partial';

    if (bucket === 'full') fullySelected += 1;
    else if (bucket === 'partial') partial += 1;
    else none += 1;

    if (!byBatch[s.batchId]) byBatch[s.batchId] = { full: 0, partial: 0, none: 0, total: 0 };
    byBatch[s.batchId].total += 1;
    byBatch[s.batchId][bucket] += 1;
  }

  // Professors fully booked — count those with at least one course where seats are exhausted.
  const fullyBookedSet = new Set();
  const profCourseStatus = [];
  const profsById = Object.fromEntries(professors.map((p) => [p.professorId, p]));
  for (const c of caps) {
    const seatsUsed = liveUsage[`${c.professorId}|${c.courseId}`] || 0;
    const remaining = Math.max(0, c.maxStudents - seatsUsed);
    if (remaining === 0 && seatsUsed > 0) fullyBookedSet.add(c.professorId);
    profCourseStatus.push({
      professorId: c.professorId,
      professorName: profsById[c.professorId]?.name || c.professorId,
      courseId: c.courseId,
      maxStudents: c.maxStudents,
      seatsUsed,
      seatsRemaining: remaining,
      full: remaining === 0 && seatsUsed > 0,
    });
  }

  // Allotment (phase 2) coverage
  // A registration is allotted only when its own section got a room, not
  // merely when some other section of the same course did.
  const scopeCourses = new Set(students.flatMap((s) => (regsByStudent[s.studentId] || []).map((r) => r.courseId)));
  const sectionsCount = semester || batchId
    ? entries.filter((e) => scopeCourses.has(e.courseId)).length
    : entries.length;
  const allottedCourseIds = new Set(entries.map((e) => e.courseId));
  const placedSections = new Set(entries.map((e) => `${e.courseId}|${e.slotCode}|${e.professorId}`));
  const registeredCourseIds = new Set(regs.map((r) => r.courseId));
  let studentsAllotted = 0;
  for (const s of students) {
    const srs = regsByStudent[s.studentId] || [];
    if (srs.length === 0) continue;
    if (srs.every((r) => placedSections.has(`${r.courseId}|${r.slotCode}|${r.professorId}`))) studentsAllotted += 1;
  }

  return {
    termId,
    term: term ? {
      status: term.status,
      registrationOpen: term.registrationOpen,
      schedulingLocked: term.schedulingLocked,
    } : null,
    filter: { batchId, semester },
    totals: {
      students: students.length,
      offerings: offerings.filter((o) => byBatch[o.batchId]).length,
      fullySelected,
      partial,
      none,
      studentsAllotted,
      sections: sectionsCount,
      fullyBookedProfessors: fullyBookedSet.size,
    },
    byBatch,
    professorCourseStatus: profCourseStatus,
    coverage: {
      registeredCoursesCount: registeredCourseIds.size,
      allottedCoursesCount: allottedCourseIds.size,
    },
  };
}

export async function listBatches() {
  return Batch.find().sort({ semester: 1, batchName: 1 }).lean();
}

/**
 * One row per semester running in the term: cohort size, programme,
 * registration progress and how much of its timetable is published.
 */
export async function semesterSummaries() {
  const [semesters, batches] = await Promise.all([
    Semester.find().sort({ semester: 1 }).lean(),
    Batch.find().lean(),
  ]);
  const rows = [];
  for (const sem of semesters) {
    const status = await cohortStatus({ termId: sem.termId, semester: sem.semester });
    rows.push({
      semester: sem.semester,
      name: sem.name,
      termId: sem.termId,
      creditsRequired: sem.creditsRequired,
      timetableSource: sem.timetableSource,
      batches: batches.filter((b) => b.semester === sem.semester).map((b) => b.batchId),
      totals: status.totals,
    });
  }
  return rows;
}
