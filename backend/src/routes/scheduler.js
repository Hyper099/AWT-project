import { asyncRouter } from '../middleware/asyncRouter.js';
import Course from '../models/Course.js';
import Room from '../models/Room.js';
import Building from '../models/Building.js';
import Professor from '../models/Professor.js';
import Student from '../models/Student.js';
import Registration from '../models/Registration.js';
import Semester from '../models/Semester.js';
import TimetableEntry from '../models/TimetableEntry.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { runScheduler, findSelectionConflicts } from '../scheduler/algorithm.js';
import { notifyStudents } from '../services/notifyStudents.js';
import { cohortStatus } from '../services/adminStatus.js';
import { resolveTerm, studentsInTerm } from '../services/enrolment.js';

const router = asyncRouter();
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
router.use(requireAuth, requireRole('admin'));

/**
 * Admin-only scheduler trigger, for the whole term or one semester
 * (`semester`). Refuses if any student in scope is not fully selected, or if
 * the selections contain clashes (unless `force: true`). Publishing one
 * semester keeps the other semesters' published sections and works around
 * their rooms and instructors. Only students whose every registration got a
 * room are notified; the response lists what could not be placed.
 */
router.post('/generate-timetable', async (req, res) => {
  const force = req.body?.force === true;
  const semester = req.body?.semester == null || req.body.semester === '' ? null : Number(req.body.semester);
  const termId = await resolveTerm({ termId: typeof req.body?.termId === 'string' ? req.body.termId : null, semester });
  if (semester !== null && !(await Semester.exists({ semester }))) {
    return res.status(404).json({ error: `semester ${req.body.semester} not found` });
  }

  const [courses, rooms, buildings, professors, students, termRegistrations, otherEntries] = await Promise.all([
    Course.find().lean(),
    Room.find().lean(),
    Building.find().lean(),
    Professor.find().lean(),
    studentsInTerm(termId, { semester }),
    Registration.find({ termId }).lean(),
    semester ? TimetableEntry.find({ termId, semester: { $ne: semester } }).lean() : [],
  ]);
  const inScope = new Set(students.map((s) => s.studentId));
  const registrations = semester ? termRegistrations.filter((r) => inScope.has(r.studentId)) : termRegistrations;

  if (!force) {
    const status = await cohortStatus({ termId, semester });
    const { partial, none, fullySelected, students: total } = status.totals;
    if (partial > 0 || none > 0) {
      return res.status(409).json({
        error: 'not all students are fully selected',
        summary: { students: total, fullySelected, partial, notStarted: none },
        hint: 'Use "Make Slots" (or "Auto-allocate cohort") first, or re-submit with { force: true } to run anyway.',
      });
    }
    // Instructor clashes are checked across the whole term: semesters share staff.
    const clashes = findSelectionConflicts(termRegistrations);
    const scopeCourses = new Set(registrations.map((r) => r.courseId));
    const studentClashes = clashes.studentClashes.filter((c) => inScope.has(c.studentId));
    const instructorClashes = clashes.instructorClashes.filter((c) => c.courses.some((id) => scopeCourses.has(id)));
    if (studentClashes.length || instructorClashes.length) {
      return res.status(409).json({
        error: `Selections contain ${plural(studentClashes.length, 'student clash', 'student clashes')} and `
          + `${plural(instructorClashes.length, 'instructor clash', 'instructor clashes')}. `
          + 'Run "Auto-allocate cohort" to rebuild clash-free selections, then publish again.',
        examples: { students: studentClashes.slice(0, 5), instructors: instructorClashes.slice(0, 5) },
        hint: 'Run "Auto-allocate cohort" to rebuild clash-free selections.',
      });
    }
  }

  const { assignments, score, unplaced, sectionsTotal } = runScheduler({
    courses, rooms, buildings, professors, students, registrations, termId, preBooked: otherEntries,
  });

  await TimetableEntry.deleteMany(semester ? { termId, semester } : { termId });
  const placed = new Set();
  if (assignments.length) {
    const docs = await TimetableEntry.insertMany(assignments, { ordered: false }).catch((err) => {
      // A unique-index rejection means a room or instructor was double-booked;
      // keep what was saved and report the rest as unplaced.
      if (err.code !== 11000 && !err.writeErrors) throw err;
      return err.insertedDocs || [];
    });
    for (const d of docs) placed.add(`${d.courseId}|${d.slotCode}|${d.professorId}`);
    for (const a of assignments) {
      if (placed.has(`${a.courseId}|${a.slotCode}|${a.professorId}`)) continue;
      const studentIds = registrations
        .filter((r) => r.courseId === a.courseId && r.slotCode === a.slotCode && r.professorId === a.professorId)
        .map((r) => r.studentId);
      unplaced.push({ courseId: a.courseId, slotCode: a.slotCode, professorId: a.professorId, studentIds, reason: 'rejected by database (double booking)' });
    }
  }

  const incomplete = new Set(unplaced.flatMap((u) => u.studentIds));
  const registered = new Set(registrations.map((r) => r.studentId));
  const completeStudents = [...registered].filter((id) => !incomplete.has(id));

  let notifications = { sent: 0, failed: 0, skipped: 0, mode: 'unknown' };
  try {
    notifications = await notifyStudents(termId, { studentIds: completeStudents });
  } catch (err) {
    console.error('[scheduler] notifyStudents failed:', err.message);
  }

  res.json({
    termId,
    semester,
    complete: unplaced.length === 0,
    sections: sectionsTotal,
    assigned: placed.size,
    unplacedSections: unplaced.length,
    unplacedRegistrations: unplaced.reduce((n, u) => n + u.studentIds.length, 0),
    studentsComplete: completeStudents.length,
    studentsIncomplete: incomplete.size,
    unplaced: unplaced.slice(0, 20).map(({ studentIds, ...u }) => ({ ...u, students: studentIds.length })),
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
