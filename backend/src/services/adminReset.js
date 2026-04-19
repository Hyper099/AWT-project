import Registration from '../models/Registration.js';
import TimetableEntry from '../models/TimetableEntry.js';
import ProfessorCapacity from '../models/ProfessorCapacity.js';

/**
 * Clear Registration (selection) rows. Scope can be:
 *   { studentId } — one student's selections
 *   { batchId }   — cohort-wide
 *   {}            — every student in the term
 * Seat counters are recomputed from what remains.
 */
export async function resetSelections({ termId = 'TERM_2026_ODD', studentId = null, batchId = null } = {}) {
  const q = { termId };
  if (studentId) q.studentId = studentId;
  if (batchId) {
    const Student = (await import('../models/Student.js')).default;
    const ids = (await Student.find({ batchId }).lean()).map((s) => s.studentId);
    q.studentId = { $in: ids };
  }
  const deleted = await Registration.deleteMany(q);

  // Recompute seat usage from remaining regs
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
  return { deleted: deleted.deletedCount, scope: { termId, studentId, batchId } };
}

/**
 * Reset both selections AND timetable allotments. Seats reset to zero.
 * Leaves courses, offerings, slots, and professor records intact.
 */
export async function resetAllocation({ termId = 'TERM_2026_ODD' } = {}) {
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
