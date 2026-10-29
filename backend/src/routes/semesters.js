import { asyncRouter } from '../middleware/asyncRouter.js';
import { requireAuth } from '../middleware/auth.js';
import Batch from '../models/Batch.js';
import Semester from '../models/Semester.js';
import Slot from '../models/Slot.js';

const router = asyncRouter();
router.use(requireAuth);

/** Every semester running in the term, with its bell schedule and batches. */
router.get('/', async (_req, res) => {
  const [semesters, batches] = await Promise.all([
    Semester.find().sort({ semester: 1 }).lean(),
    Batch.find().lean(),
  ]);
  res.json(semesters.map((s) => ({
    ...s,
    batches: batches.filter((b) => b.semester === s.semester).map((b) => ({ batchId: b.batchId, batchName: b.batchName })),
  })));
});

router.get('/:semester', async (req, res) => {
  const semester = Number(req.params.semester);
  const [doc, slots] = await Promise.all([
    Semester.findOne({ semester }).lean(),
    Slot.find({ semester }).sort({ slotCode: 1 }).lean(),
  ]);
  if (!doc) return res.status(404).json({ error: `semester ${req.params.semester} not found` });
  res.json({ ...doc, slots });
});

export default router;
