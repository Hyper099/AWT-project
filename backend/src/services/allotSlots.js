import Student from '../models/Student.js';
import CourseOffering from '../models/CourseOffering.js';
import Course from '../models/Course.js';
import Slot from '../models/Slot.js';
import Registration from '../models/Registration.js';
import ProfessorCapacity from '../models/ProfessorCapacity.js';
import { slotsClash } from '../scheduler/slots.js';

/**
 * Phase-1 allocator. For every student in scope, creates a Registration for
 * each of their batch offerings by jointly picking a (slot, professor) pair.
 *
 * Hard constraints
 *   - Slot.family === Course.slotFamily.
 *   - New slot does not clash with the student's already-registered slots.
 *   - Professor has seats remaining for this course.
 *   - (professorId, slotCode) is not already committed to a DIFFERENT course.
 *
 * Strategy: for each unselected offering we scan (slot, professor) pairs in
 * canonical order and take the first feasible combination. A (batch, course)
 * slot cache makes subsequent students in the same batch reuse the same
 * section when possible (so the 72 students of Div-1 taking CS001 all land in
 * the same section). If the cached section is saturated, the next student
 * tries alternative (slot, professor) pairs — naturally creating overflow
 * sections when demand exceeds the first professor's capacity.
 */
export async function allotSlots({ termId = 'TERM_2026_ODD', semester = null, batchId = null } = {}) {
  const studentQ = {};
  if (batchId) studentQ.batchId = batchId;
  if (semester) studentQ.semester = Number(semester);
  const students = await Student.find(studentQ).lean();
  if (students.length === 0) return { created: 0, skipped: 0, failures: [], byCourse: {} };

  const batchIds = [...new Set(students.map((s) => s.batchId))];
  const [offerings, courses, slots, caps, existing] = await Promise.all([
    CourseOffering.find({ termId, batchId: { $in: batchIds } }).lean(),
    Course.find().lean(),
    Slot.find().lean(),
    ProfessorCapacity.find({ termId }).lean(),
    Registration.find({ termId, studentId: { $in: students.map((s) => s.studentId) } }).lean(),
  ]);

  const offeringsByBatch = {};
  for (const o of offerings) (offeringsByBatch[o.batchId] ||= []).push(o);
  const courseById = Object.fromEntries(courses.map((c) => [c.courseId, c]));
  const slotsByFamily = {};
  for (const s of slots) (slotsByFamily[s.family] ||= []).push(s);
  const slotByCode = Object.fromEntries(slots.map((s) => [s.slotCode, s]));
  const existingByStudent = {};
  for (const r of existing) (existingByStudent[r.studentId] ||= []).push(r);

  const seatsByKey = {};
  for (const c of caps) {
    seatsByKey[`${c.professorId}|${c.courseId}`] = {
      professorId: c.professorId, courseId: c.courseId,
      maxStudents: c.maxStudents, seatsUsed: c.seatsUsed,
      _dirty: false,
    };
  }
  const eligibleProfsByCourse = {};
  for (const key of Object.keys(seatsByKey)) {
    const s = seatsByKey[key];
    (eligibleProfsByCourse[s.courseId] ||= []).push(s.professorId);
  }

  // (profId|slotCode) → courseId currently committed. A professor cannot
  // teach two DIFFERENT courses at the same slotCode.
  const profSlotOccupancy = {};
  for (const r of existing) {
    if (r.professorId && r.slotCode) {
      profSlotOccupancy[`${r.professorId}|${r.slotCode}`] = r.courseId;
    }
  }

  // (batch|course) → preferred (slot, prof) section. First student picks;
  // reused by subsequent students so a batch lands in the same section when
  // capacity allows.
  const sectionCache = {};

  /** Try each (slot, prof) pair in canonical order. Returns the first feasible
   *  combination or null. Caller mutates seats/occupancy on success. */
  function findFeasibleSection(student, course, batchId) {
    const family = course.slotFamily || 'THEORY_3';
    const slotPool = (slotsByFamily[family] || []);
    if (slotPool.length === 0) return null;
    const profIds = eligibleProfsByCourse[course.courseId] || [];
    if (profIds.length === 0) return null;

    const existingSlots = (existingByStudent[student.studentId] || [])
      .map((r) => slotByCode[r.slotCode])
      .filter(Boolean);

    const cached = sectionCache[`${batchId}|${course.courseId}`];
    const orderedSlots = cached
      ? [slotByCode[cached.slotCode], ...slotPool.filter((s) => s.slotCode !== cached.slotCode)]
      : slotPool;

    for (const slot of orderedSlots) {
      if (!slot) continue;
      // Hard: no clash with this student's existing regs.
      if (existingSlots.some((es) => slotsClash(es, slot))) continue;
      const orderedProfs = cached && cached.slotCode === slot.slotCode
        ? [cached.professorId, ...profIds.filter((p) => p !== cached.professorId)]
        : profIds;
      for (const pid of orderedProfs) {
        const slotKey = `${pid}|${slot.slotCode}`;
        const occupied = profSlotOccupancy[slotKey];
        if (occupied && occupied !== course.courseId) continue;
        const seats = seatsByKey[`${pid}|${course.courseId}`];
        if (!seats || seats.seatsUsed >= seats.maxStudents) continue;
        return { slot, professorId: pid };
      }
    }
    return null;
  }

  let created = 0;
  let skipped = 0;
  const failures = [];
  const byCourse = {};
  const newRegs = [];

  for (const student of students) {
    const batchOfferings = offeringsByBatch[student.batchId] || [];
    const existingCourses = new Set((existingByStudent[student.studentId] || []).map((r) => r.courseId));
    for (const off of batchOfferings) {
      if (existingCourses.has(off.courseId)) { skipped += 1; continue; }
      const course = courseById[off.courseId];
      if (!course) {
        failures.push({ studentId: student.studentId, courseId: off.courseId, reason: 'course not found' });
        continue;
      }
      const pick = findFeasibleSection(student, course, student.batchId);
      if (!pick) {
        failures.push({ studentId: student.studentId, courseId: off.courseId, reason: 'no feasible slot+instructor' });
        continue;
      }
      // Commit
      const seats = seatsByKey[`${pick.professorId}|${course.courseId}`];
      seats.seatsUsed += 1; seats._dirty = true;
      profSlotOccupancy[`${pick.professorId}|${pick.slot.slotCode}`] = course.courseId;
      sectionCache[`${student.batchId}|${course.courseId}`] = {
        slotCode: pick.slot.slotCode, professorId: pick.professorId,
      };
      (existingByStudent[student.studentId] ||= []).push({
        courseId: off.courseId, slotCode: pick.slot.slotCode,
      });
      newRegs.push({
        studentId: student.studentId,
        courseId: off.courseId,
        courseOfferingId: off.courseOfferingId,
        slotCode: pick.slot.slotCode,
        professorId: pick.professorId,
        termId,
        status: 'confirmed',
      });
      created += 1;
      byCourse[off.courseId] = (byCourse[off.courseId] || 0) + 1;
    }
  }

  if (newRegs.length) {
    await Registration.insertMany(newRegs, { ordered: false }).catch((err) => {
      if (err.code !== 11000) throw err;
    });
  }
  const dirty = Object.values(seatsByKey).filter((s) => s._dirty);
  await Promise.all(dirty.map((s) =>
    ProfessorCapacity.updateOne(
      { professorId: s.professorId, courseId: s.courseId, termId },
      { $set: { seatsUsed: s.seatsUsed } },
    ),
  ));

  return { created, skipped, failures, byCourse };
}
