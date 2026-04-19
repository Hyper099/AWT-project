import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import Batch from '../models/Batch.js';
import { allotSlots } from '../services/allotSlots.js';
import { cohortStatus } from '../services/adminStatus.js';
import { resetSelections, resetAllocation } from '../services/adminReset.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

router.get('/batches', async (_req, res) => {
  const b = await Batch.find().sort({ semester: 1, batchName: 1 }).lean();
  res.json(b);
});

router.get('/status', async (req, res) => {
  const termId = req.query.termId || 'TERM_2026_ODD';
  const batchId = req.query.batchId || null;
  const semester = req.query.semester ? Number(req.query.semester) : null;
  const s = await cohortStatus({ termId, batchId, semester });
  res.json(s);
});

router.post('/allot-slots', async (req, res) => {
  const { termId = 'TERM_2026_ODD', batchId = null, semester = null } = req.body || {};
  const r = await allotSlots({ termId, batchId, semester });
  res.json(r);
});

router.post('/reset-selections', async (req, res) => {
  const { termId = 'TERM_2026_ODD', studentId = null, batchId = null } = req.body || {};
  const r = await resetSelections({ termId, studentId, batchId });
  res.json(r);
});

router.post('/reset-allocation', async (req, res) => {
  const { termId = 'TERM_2026_ODD' } = req.body || {};
  const r = await resetAllocation({ termId });
  res.json(r);
});

/**
 * Cohort-wide shortcut: reset → allot-slots for every student. Useful for demos.
 */
router.post('/allocate-all', async (req, res) => {
  const { termId = 'TERM_2026_ODD' } = req.body || {};
  await resetAllocation({ termId });
  const r = await allotSlots({ termId });
  res.json({ reset: true, ...r });
});

export default router;
