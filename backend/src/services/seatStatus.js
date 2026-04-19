import Registration from '../models/Registration.js';

/**
 * Returns a map of live seat usage grouped by (professorId|courseId) for a term.
 * This is derived from registrations, so it stays accurate even if counters drift.
 */
export async function getLiveSeatUsageMap(termId = 'TERM_2026_ODD') {
  const rows = await Registration.aggregate([
    { $match: { termId, professorId: { $ne: null } } },
    {
      $group: {
        _id: { professorId: '$professorId', courseId: '$courseId' },
        seatsUsed: { $sum: 1 },
      },
    },
  ]);

  const usage = {};
  for (const r of rows) {
    const key = `${r._id.professorId}|${r._id.courseId}`;
    usage[key] = r.seatsUsed;
  }
  return usage;
}
