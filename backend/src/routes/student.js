import { Router } from 'express';
import Student from '../models/Student.js';
import Registration from '../models/Registration.js';
import Course from '../models/Course.js';
import CourseOffering from '../models/CourseOffering.js';
import ProfessorCapacity from '../models/ProfessorCapacity.js';
import Slot from '../models/Slot.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { slotsClash, SLOT_BY_CODE } from '../scheduler/slots.js';
import { offeringsForStudent, professorsForCourse } from '../services/offerings.js';
import {
  buildTimetableRows,
  timetableStatus,
  renderCsv,
  renderPdfToStream,
} from '../services/timetableExport.js';

const router = Router();
router.use(requireAuth, requireRole('student'));

router.get('/me', async (req, res) => {
  const s = await Student.findOne({ studentId: req.user.studentId }).lean();
  res.json(s);
});

router.get('/offerings', async (req, res) => {
  const termId = req.query.termId || 'TERM_2026_ODD';
  const list = await offeringsForStudent(req.user.studentId, termId);
  res.json(list);
});

router.get('/professors', async (req, res) => {
  const { courseId } = req.query;
  if (!courseId) return res.status(400).json({ error: 'courseId required' });
  const termId = req.query.termId || 'TERM_2026_ODD';
  const profs = await professorsForCourse(courseId, termId);
  res.json(profs);
});

/**
 * Register for a course. Requires { courseId, slotCode, professorId }.
 * Enforces slot-family match, no slot clash, and decrements professor seats.
 */
router.post('/register', async (req, res) => {
  const { courseId, slotCode, professorId, termId = 'TERM_2026_ODD' } = req.body || {};
  if (!courseId || !slotCode) return res.status(400).json({ error: 'courseId and slotCode required' });

  const [course, offering, slot] = await Promise.all([
    Course.findOne({ courseId }).lean(),
    CourseOffering.findOne({ termId, courseId, batchId: (await Student.findOne({ studentId: req.user.studentId }).lean())?.batchId }).lean(),
    Slot.findOne({ slotCode }).lean(),
  ]);
  if (!course) return res.status(404).json({ error: 'course not found' });
  if (!slot) return res.status(400).json({ error: 'invalid slotCode' });
  if (!offering) return res.status(403).json({ error: 'course not offered to your batch this term' });

  // Hard: slot family must match course family
  if (course.slotFamily && slot.family && course.slotFamily !== slot.family) {
    return res.status(409).json({
      error: `slot ${slotCode} (${slot.family}) is incompatible with course family ${course.slotFamily}`,
    });
  }

  // Clash check
  const existing = await Registration.find({ studentId: req.user.studentId, termId }).lean();
  const newSlot = SLOT_BY_CODE[slotCode];
  for (const r of existing) {
    if (r.courseId === courseId) return res.status(409).json({ error: 'already registered' });
    const otherSlot = SLOT_BY_CODE[r.slotCode];
    if (otherSlot && slotsClash(newSlot, otherSlot)) {
      return res.status(409).json({ error: `slot clash with ${r.courseId} (${r.slotCode})` });
    }
  }

  // Seat claim — atomic decrement if professorId provided.
  if (professorId) {
    const claim = await ProfessorCapacity.findOneAndUpdate(
      { professorId, courseId, termId, $expr: { $lt: ['$seatsUsed', '$maxStudents'] } },
      { $inc: { seatsUsed: 1 } },
      { new: true },
    );
    if (!claim) return res.status(409).json({ error: 'no seats remaining for that instructor' });
  }

  try {
    const reg = await Registration.create({
      studentId: req.user.studentId, courseId, slotCode,
      professorId: professorId || null,
      courseOfferingId: offering.courseOfferingId,
      termId,
    });
    return res.status(201).json(reg);
  } catch (err) {
    // Refund seat on unique-index or other failure
    if (professorId) {
      await ProfessorCapacity.updateOne(
        { professorId, courseId, termId },
        { $inc: { seatsUsed: -1 } },
      );
    }
    if (err.code === 11000) return res.status(409).json({ error: 'already registered' });
    throw err;
  }
});

router.delete('/register/:courseId', async (req, res) => {
  const { courseId } = req.params;
  const termId = req.query.termId || 'TERM_2026_ODD';
  const r = await Registration.findOneAndDelete({ studentId: req.user.studentId, courseId, termId });
  if (!r) return res.status(404).json({ error: 'not registered' });
  if (r.professorId) {
    await ProfessorCapacity.updateOne(
      { professorId: r.professorId, courseId, termId },
      { $inc: { seatsUsed: -1 } },
    );
  }
  res.json({ ok: true });
});

router.get('/registrations', async (req, res) => {
  const termId = req.query.termId || 'TERM_2026_ODD';
  const regs = await Registration.find({ studentId: req.user.studentId, termId }).lean();
  res.json(regs);
});

router.get('/timetable', async (req, res) => {
  const termId = req.query.termId || 'TERM_2026_ODD';
  const { rows } = await buildTimetableRows(req.user.studentId, termId);
  res.json(rows);
});

router.get('/timetable/status', async (req, res) => {
  const termId = req.query.termId || 'TERM_2026_ODD';
  const status = await timetableStatus(req.user.studentId, termId);
  res.json(status);
});

router.get('/timetable/download', async (req, res) => {
  const termId = req.query.termId || 'TERM_2026_ODD';
  const format = (req.query.format || 'pdf').toLowerCase();
  const data = await buildTimetableRows(req.user.studentId, termId);
  const baseFilename = `timetable_${data.student?.studentId || 'student'}_${termId}`;
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${baseFilename}.csv"`);
    return res.send(renderCsv(data));
  }
  if (format === 'pdf') {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${baseFilename}.pdf"`);
    return renderPdfToStream(data, res);
  }
  return res.status(400).json({ error: 'format must be pdf or csv' });
});

export default router;
