import { DEFAULT_TERM_ID } from '../constants/term.js';
import Batch from '../models/Batch.js';
import CourseOffering from '../models/CourseOffering.js';
import Professor from '../models/Professor.js';
import ProfessorCapacity from '../models/ProfessorCapacity.js';
import Registration from '../models/Registration.js';
import Student from '../models/Student.js';
import Term from '../models/Term.js';
import TimetableEntry from '../models/TimetableEntry.js';
import { getLiveSeatUsageMap } from './seatStatus.js';

/**
 * Cohort status: per-student selection completeness + professor seat status.
 * `batchId` and `semester` are optional filters; default scope is the whole term.
 */
export async function cohortStatus({ termId = DEFAULT_TERM_ID, batchId = null, semester = null } = {}) {
  const studentQ = {};
  if (batchId) studentQ.batchId = batchId;
  if (semester) studentQ.semester = Number(semester);
  const [students, offerings, regs, caps, entries, term, professors] = await Promise.all([
    Student.find(studentQ).lean(),
    CourseOffering.find({ termId }).lean(),
    Registration.find({ termId }).lean(),
    ProfessorCapacity.find({ termId }).lean(),
    TimetableEntry.find({ termId }).lean(),
    Term.findOne({ termId }).lean(),
    Professor.find().lean(),
  ]);
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
    const required = (offeringsByBatch[s.batchId] || []).length;
    const selected = (regsByStudent[s.studentId] || []).length;
    let bucket;
    if (required === 0) bucket = 'none';
    else if (selected === 0) bucket = 'none';
    else if (selected < required) bucket = 'partial';
    else bucket = 'full';

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
  const sectionsCount = entries.length;
  const allottedCourseIds = new Set(entries.map((e) => e.courseId));
  const registeredCourseIds = new Set(regs.map((r) => r.courseId));
  let studentsAllotted = 0;
  for (const s of students) {
    const srs = regsByStudent[s.studentId] || [];
    if (srs.length === 0) continue;
    if (srs.every((r) => allottedCourseIds.has(r.courseId))) studentsAllotted += 1;
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
      offerings: offerings.length,
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
