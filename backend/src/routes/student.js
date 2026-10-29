import { asyncRouter, optionalString, requireString } from '../middleware/asyncRouter.js';
import Professor from '../models/Professor.js';
import Room from '../models/Room.js';
import { createSectionPlanner } from '../scheduler/sectionPlanner.js';
import Student from '../models/Student.js';
import Registration from '../models/Registration.js';
import Course from '../models/Course.js';
import CourseOffering from '../models/CourseOffering.js';
import ProfessorCapacity from '../models/ProfessorCapacity.js';
import Semester from '../models/Semester.js';
import Slot from '../models/Slot.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { slotsClash, SLOT_BY_CODE } from '../scheduler/slots.js';
import { offeringsForStudent, professorsForCourse } from '../services/offerings.js';
import { programmeProgress, slotsForOffering } from '../services/programme.js';
import {
  buildTimetableRows,
  timetableStatus,
  renderCsv,
  renderPdfToStream,
} from '../services/timetableExport.js';

const router = asyncRouter();
router.use(requireAuth, requireRole('student'));

async function plannerForTerm(termId) {
  const [courses, rooms, professors, registrations] = await Promise.all([
    Course.find().lean(), Room.find().lean(), Professor.find().lean(),
    Registration.find({ termId }).lean(),
  ]);
  return createSectionPlanner({ courses, rooms, professors, registrations });
}

router.get('/me', async (req, res) => {
  const s = await Student.findOne({ studentId: req.user.studentId }).lean();
  res.json(s);
});

/** The student's semester: bell schedule (periods) and the slots of its grid. */
router.get('/grid', async (req, res) => {
  const student = await Student.findOne({ studentId: req.user.studentId }).lean();
  if (!student) return res.status(404).json({ error: 'student not found' });
  const [semester, slots] = await Promise.all([
    Semester.findOne({ semester: student.semester }).lean(),
    Slot.find({ semester: student.semester }).sort({ slotCode: 1 }).lean(),
  ]);
  res.json({ semester: semester || { semester: student.semester, name: `Semester ${student.semester}`, periods: [] }, slots });
});

/** Compulsory courses, elective baskets, and how far the student has got. */
router.get('/programme', async (req, res) => {
  const termId = req.query.termId || 'TERM_2026_ODD';
  const student = await Student.findOne({ studentId: req.user.studentId }).lean();
  if (!student) return res.status(404).json({ error: 'student not found' });
  const [offerings, regs, semester] = await Promise.all([
    CourseOffering.find({ termId, batchId: student.batchId }).lean(),
    Registration.find({ termId, studentId: student.studentId }).lean(),
    Semester.findOne({ semester: student.semester }).lean(),
  ]);
  const courses = await Course.find({ courseId: { $in: offerings.map((o) => o.courseId) } }).lean();
  const creditsOf = Object.fromEntries(courses.map((c) => [c.courseId, c.credits]));
  const progress = programmeProgress(offerings, regs);
  res.json({
    termId,
    semester: student.semester,
    creditsRequired: semester?.creditsRequired ?? null,
    creditsSelected: regs.reduce((n, r) => n + (creditsOf[r.courseId] || 0), 0),
    ...progress,
  });
});

router.get('/offerings', async (req, res) => {
  const termId = req.query.termId || 'TERM_2026_ODD';
  const list = await offeringsForStudent(req.user.studentId, termId);
  res.json(list);
});

router.get('/professors', async (req, res) => {
  const courseId = requireString(req.query, 'courseId');
  const slotCode = optionalString(req.query, 'slotCode');
  const termId = optionalString(req.query, 'termId') || 'TERM_2026_ODD';
  const profs = await professorsForCourse(courseId, termId);
  if (!slotCode) return res.json(profs);
  // Flag instructors the student cannot pick for this particular slot.
  const planner = await plannerForTerm(termId);
  res.json(profs.map((p) => {
    const reason = planner.instructorConflict(p.professorId, courseId, slotCode)
      || (planner.roomsFit(courseId, slotCode, p.professorId) ? null : 'no room free for this section at this time');
    return { ...p, available: !reason, unavailableReason: reason };
  }));
});

/**
 * Register for a course. Requires { courseId, slotCode, professorId }.
 * Enforces slot-family match, no slot clash, and decrements professor seats.
 */
router.post('/register', async (req, res) => {
  const body = req.body || {};
  const courseId = requireString(body, 'courseId');
  const slotCode = requireString(body, 'slotCode');
  // Without an instructor the section can never be scheduled, so require one.
  const professorId = requireString(body, 'professorId');
  const termId = optionalString(body, 'termId') || 'TERM_2026_ODD';

  const student = await Student.findOne({ studentId: req.user.studentId }).lean();
  const [course, offering, slot, batchOfferings] = await Promise.all([
    Course.findOne({ courseId }).lean(),
    CourseOffering.findOne({ termId, courseId, batchId: student?.batchId }).lean(),
    Slot.findOne({ slotCode }).lean(),
    CourseOffering.find({ termId, batchId: student?.batchId }).lean(),
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
  // Hard: the slot must be on this semester's grid and one the course runs in.
  if (!slotsForOffering(offering, course, [slot]).length) {
    const where = offering.allowedSlots?.length ? offering.allowedSlots.join(', ') : `Semester ${course.semester} slots`;
    return res.status(409).json({ error: `${course.code} does not run in slot ${slotCode}; choose one of ${where}` });
  }

  // Clash check
  const existing = await Registration.find({ studentId: req.user.studentId, termId }).lean();

  // One option per elective basket.
  if (offering.electiveGroup) {
    const offeringByCourse = Object.fromEntries(batchOfferings.map((o) => [o.courseId, o]));
    const other = existing
      .map((r) => offeringByCourse[r.courseId])
      .find((o) => o?.electiveGroup === offering.electiveGroup && o.electiveOption !== offering.electiveOption);
    if (other) {
      const otherCourse = await Course.findOne({ courseId: other.electiveOption }).lean();
      return res.status(409).json({
        error: `you already chose ${otherCourse?.title || other.electiveOption} for ${offering.electiveGroup}; drop it first to switch`,
      });
    }
  }
  const newSlot = SLOT_BY_CODE[slotCode];
  for (const r of existing) {
    if (r.courseId === courseId) return res.status(409).json({ error: 'already registered' });
    const otherSlot = SLOT_BY_CODE[r.slotCode];
    if (otherSlot && slotsClash(newSlot, otherSlot)) {
      return res.status(409).json({ error: `slot clash with ${r.courseId} (${r.slotCode})` });
    }
  }

  // Instructor must be free at this time, and the section must still fit a room.
  const planner = await plannerForTerm(termId);
  const conflict = planner.instructorConflict(professorId, courseId, slotCode);
  if (conflict) return res.status(409).json({ error: `${conflict}; choose another instructor or slot` });
  if (!planner.roomsFit(courseId, slotCode, professorId)) {
    return res.status(409).json({ error: 'no room large enough is free for this section at this time; choose another instructor or slot' });
  }

  // Seat claim — atomic decrement.
  const claim = await ProfessorCapacity.findOneAndUpdate(
    { professorId, courseId, termId, $expr: { $lt: ['$seatsUsed', '$maxStudents'] } },
    { $inc: { seatsUsed: 1 } },
    { new: true },
  );
  if (!claim) return res.status(409).json({ error: 'no seats remaining for that instructor' });

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
    await ProfessorCapacity.updateOne(
      { professorId, courseId, termId },
      { $inc: { seatsUsed: -1 } },
    );
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
