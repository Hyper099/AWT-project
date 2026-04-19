import { Router } from 'express';
import Course from '../models/Course.js';
import Slot from '../models/Slot.js';

const router = Router();

router.get('/', async (req, res) => {
  const { department, semester } = req.query;
  const q = {};
  if (department) q.department = department;
  if (semester) q.semester = Number(semester);
  const courses = await Course.find(q).lean();
  res.json(courses);
});

router.get('/slots', async (_req, res) => {
  const slots = await Slot.find().lean();
  res.json(slots);
});

export default router;
