import { Router } from 'express';
import Professor from '../models/Professor.js';
import Course from '../models/Course.js';
import TimetableEntry from '../models/TimetableEntry.js';
import Slot from '../models/Slot.js';
import Room from '../models/Room.js';
import Building from '../models/Building.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireRole('professor'));

router.get('/me', async (req, res) => {
  const p = await Professor.findOne({ professorId: req.user.professorId }).lean();
  res.json(p);
});

/** Update teaching choices + availability. */
router.post('/courses/select', async (req, res) => {
  const { teachingCourses, preferredSlots, unavailableSlots, maxHoursPerWeek } = req.body || {};
  const update = {};
  if (Array.isArray(teachingCourses)) update.teachingCourses = teachingCourses;
  if (Array.isArray(preferredSlots)) update.preferredSlots = preferredSlots;
  if (Array.isArray(unavailableSlots)) update.unavailableSlots = unavailableSlots;
  if (typeof maxHoursPerWeek === 'number') update.maxHoursPerWeek = maxHoursPerWeek;
  const p = await Professor.findOneAndUpdate(
    { professorId: req.user.professorId },
    { $set: update },
    { new: true }
  );
  res.json(p);
});

router.get('/courses', async (req, res) => {
  const p = await Professor.findOne({ professorId: req.user.professorId }).lean();
  if (!p) return res.status(404).json({ error: 'professor not found' });
  const courses = await Course.find({ courseId: { $in: p.eligibleCourses || [] } }).lean();
  res.json(courses);
});

router.get('/timetable', async (req, res) => {
  const termId = req.query.termId || 'TERM_2026_ODD';
  const entries = await TimetableEntry.find({ termId, professorId: req.user.professorId }).lean();

  const [slots, courses, rooms, buildings] = await Promise.all([
    Slot.find().lean(),
    Course.find({ courseId: { $in: entries.map((e) => e.courseId) } }).lean(),
    Room.find().lean(),
    Building.find().lean(),
  ]);
  const slotByCode = Object.fromEntries(slots.map((s) => [s.slotCode, s]));
  const courseById = Object.fromEntries(courses.map((c) => [c.courseId, c]));
  const roomById = Object.fromEntries(rooms.map((r) => [r.roomId, r]));
  const bldById = Object.fromEntries(buildings.map((b) => [b.buildingId, b]));

  const rows = [];
  for (const e of entries) {
    const slot = slotByCode[e.slotCode];
    const course = courseById[e.courseId];
    const room = roomById[e.roomId];
    const bld = room ? bldById[room.buildingId] : null;
    if (!slot || !course) continue;
    for (const m of slot.meetings) {
      rows.push({
        day: m.day, startMinute: m.startMinute, endMinute: m.endMinute,
        courseId: course.courseId, courseCode: course.code, courseTitle: course.title,
        slotCode: e.slotCode, roomName: room?.name, buildingName: bld?.name,
        enrolled: e.enrolled,
      });
    }
  }
  res.json(rows);
});

export default router;
