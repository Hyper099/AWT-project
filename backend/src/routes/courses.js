import { asyncRouter } from '../middleware/asyncRouter.js';
import Course from '../models/Course.js';
import Slot from '../models/Slot.js';

const router = asyncRouter();

router.get('/', async (req, res) => {
  const { department, semester } = req.query;
  const q = {};
  if (department) q.department = department;
  if (semester) q.semester = Number(semester);
  const courses = await Course.find(q).lean();
  res.json(courses);
});

router.get('/slots', async (req, res) => {
  const q = req.query.semester ? { semester: Number(req.query.semester) } : {};
  const slots = await Slot.find(q).sort({ slotCode: 1 }).lean();
  res.json(slots);
});

export default router;
