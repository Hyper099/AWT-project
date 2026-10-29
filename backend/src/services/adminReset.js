import Registration from '../models/Registration.js';
import TimetableEntry from '../models/TimetableEntry.js';
import ProfessorCapacity from '../models/ProfessorCapacity.js';
import { studentsInTerm } from './enrolment.js';

/** Student ids in scope, or null for the whole term. */
async function scopedStudentIds({ termId, studentId = null, batchId = null, semester = null }) {
  if (studentId) return [studentId];
  if (!batchId && !semester) return null;
  return (await studentsInTerm(termId, { semester, batchId })).map((s) => s.studentId);
}

/** Recomputes every seat counter in the term from the registrations left. */
async function recountSeats(termId) {
  const remaining = await Registration.find({ termId }).lean();
  const usage = {};
  for (const r of remaining) {
    if (!r.professorId) continue;
    usage[`${r.professorId}|${r.courseId}`] = (usage[`${r.professorId}|${r.courseId}`] || 0) + 1;
  }
  const caps = await ProfessorCapacity.find({ termId }).lean();
  await Promise.all(caps.map((c) => {
    const used = usage[`${c.professorId}|${c.courseId}`] || 0;
    if (used === c.seatsUsed) return Promise.resolve();
    return ProfessorCapacity.updateOne(
      { professorId: c.professorId, courseId: c.courseId, termId },
      { $set: { seatsUsed: used } },
    );
  }));
}

/**
 * Clear Registration (selection) rows. Scope can be:
 *   { studentId } — one student's selections
 *   { batchId }   — one batch
 *   { semester }  — one semester's students
 *   {}            — every student in the term
 * Seat counters are recomputed from what remains.
 */
export async function resetSelections({ termId = 'TERM_2026_ODD', studentId = null, batchId = null, semester = null } = {}) {
  const q = { termId };
  const ids = await scopedStudentIds({ termId, studentId, batchId, semester });
  if (ids) q.studentId = { $in: ids };
  const deleted = await Registration.deleteMany(q);
  await recountSeats(termId);
  return { deleted: deleted.deletedCount, scope: { termId, studentId, batchId, semester } };
}

/**
 * Reset both selections AND timetable allotments, for the whole term or one
 * semester. Leaves courses, offerings, slots, and professor records intact.
 */
export async function resetAllocation({ termId = 'TERM_2026_ODD', semester = null } = {}) {
  if (semester) {
    const ids = await scopedStudentIds({ termId, semester });
    const [regs, entries] = await Promise.all([
      Registration.deleteMany({ termId, studentId: { $in: ids } }),
      TimetableEntry.deleteMany({ termId, semester: Number(semester) }),
    ]);
    await recountSeats(termId);
    return { selectionsDeleted: regs.deletedCount, entriesDeleted: entries.deletedCount, scope: { termId, semester } };
  }
  const [regs, entries] = await Promise.all([
    Registration.deleteMany({ termId }),
    TimetableEntry.deleteMany({ termId }),
  ]);
  await ProfessorCapacity.updateMany({ termId }, { $set: { seatsUsed: 0 } });
  return {
    selectionsDeleted: regs.deletedCount,
    entriesDeleted: entries.deletedCount,
    scope: { termId },
  };
}
