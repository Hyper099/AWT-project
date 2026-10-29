import { asyncRouter } from '../middleware/asyncRouter.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import Batch from '../models/Batch.js';
import { allotSlots } from '../services/allotSlots.js';
import { cohortStatus, semesterSummaries } from '../services/adminStatus.js';
import { resetSelections, resetAllocation } from '../services/adminReset.js';

const router = asyncRouter();
router.use(requireAuth, requireRole('admin'));

router.get('/batches', async (_req, res) => {
  const b = await Batch.find().sort({ semester: 1, batchName: 1 }).lean();
  res.json(b);
});

router.get('/semesters', async (req, res) => {
  const termId = req.query.termId || 'TERM_2026_ODD';
  res.json(await semesterSummaries({ termId }));
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
  const { termId = 'TERM_2026_ODD', studentId = null, batchId = null, semester = null } = req.body || {};
  const r = await resetSelections({ termId, studentId, batchId, semester });
  res.json(r);
});

router.post('/reset-allocation', async (req, res) => {
  const { termId = 'TERM_2026_ODD', semester = null } = req.body || {};
  const r = await resetAllocation({ termId, semester });
  res.json(r);
});

/**
 * Cohort-wide shortcut: reset → allot-slots for every student (or one
 * semester's students). Useful for demos.
 */
router.post('/allocate-all', async (req, res) => {
  const { termId = 'TERM_2026_ODD', semester = null } = req.body || {};
  await resetAllocation({ termId, semester });
  const r = await allotSlots({ termId, semester });
  res.json({ reset: true, ...r });
});

export default router;
