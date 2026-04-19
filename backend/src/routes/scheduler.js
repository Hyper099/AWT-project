import { Router } from 'express';
import Course from '../models/Course.js';
import Room from '../models/Room.js';
import Building from '../models/Building.js';
import Professor from '../models/Professor.js';
import Student from '../models/Student.js';
import Registration from '../models/Registration.js';
import TimetableEntry from '../models/TimetableEntry.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { runScheduler } from '../scheduler/algorithm.js';
import { notifyStudents } from '../services/notifyStudents.js';
import { cohortStatus } from '../services/adminStatus.js';

const router = Router();

/**
 * Admin-gated scheduler trigger. Refuses if any student in the term is not
 * fully selected (unless `force: true` is passed). Returns score + counts +
 * notification stats.
 */
router.post('/generate-timetable', requireAuth, requireRole('admin', 'professor'), async (req, res) => {
  const termId = req.body?.termId || 'TERM_2026_ODD';
  const force = Boolean(req.body?.force);

  if (!force) {
    const status = await cohortStatus({ termId });
    const { partial, none, fullySelected, students } = status.totals;
    if (partial > 0 || none > 0) {
      return res.status(409).json({
        error: 'not all students are fully selected',
        summary: { students, fullySelected, partial, notStarted: none },
        hint: 'Use "Allot Slots" (or "Allocate all") first, or re-submit with { force: true } to run anyway.',
      });
    }
  }

  const [courses, rooms, buildings, professors, students, registrations] = await Promise.all([
    Course.find().lean(),
    Room.find().lean(),
    Building.find().lean(),
    Professor.find().lean(),
    Student.find().lean(),
    Registration.find({ termId }).lean(),
  ]);

  const { assignments, score } = runScheduler({
    courses, rooms, buildings, professors, students, registrations, termId,
  });

  await TimetableEntry.deleteMany({ termId });
  let inserted = 0;
  if (assignments.length) {
    try {
      const res = await TimetableEntry.insertMany(assignments, { ordered: false });
      inserted = res.length;
    } catch (err) {
      // Duplicate-key errors mean some residual (prof,slot) conflicts existed
      // in phase-1 data; continue with whatever was inserted and log it.
      inserted = err.insertedDocs?.length ?? (err.result?.result?.nInserted ?? 0);
      console.warn(`[scheduler] insert conflicts: ${assignments.length - inserted} entries skipped`);
    }
  }

  let notifications = { sent: 0, failed: 0, skipped: 0, mode: 'unknown' };
  try {
    notifications = await notifyStudents(termId);
  } catch (err) {
    console.error('[scheduler] notifyStudents failed:', err.message);
  }

  res.json({
    termId,
    assigned: inserted,
    attempted: assignments.length,
    score: score.total,
    components: score.components,
    notifications,
  });
});

router.get('/timetable', async (req, res) => {
  const termId = req.query.termId || 'TERM_2026_ODD';
  const entries = await TimetableEntry.find({ termId }).lean();
  res.json(entries);
});

export default router;
