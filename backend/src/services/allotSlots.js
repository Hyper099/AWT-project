import Student from '../models/Student.js';
import CourseOffering from '../models/CourseOffering.js';
import Course from '../models/Course.js';
import Slot from '../models/Slot.js';
import Registration from '../models/Registration.js';
import ProfessorCapacity from '../models/ProfessorCapacity.js';
import Professor from '../models/Professor.js';
import Room from '../models/Room.js';
import { slotsClash } from '../scheduler/slots.js';
import { createSectionPlanner } from '../scheduler/sectionPlanner.js';
import { programmeStructure, slotsForOffering } from './programme.js';

/**
 * Phase-1 allocator. For every student in scope, creates a Registration for
 * each of their batch offerings by jointly picking a (slot, professor) pair.
 *
 * Hard constraints
 *   - The slot is one the offering allows: its own list (Semester 7 courses
 *     run at fixed times) or any slot of the course's family in its semester.
 *   - New slot does not clash with the student's already-registered slots.
 *   - Professor has seats remaining for this course.
 *   - Professor is free: not unavailable, not teaching a different course in
 *     this slot, and not teaching anything in an overlapping slot.
 *   - A room of the right type and size is still free for the section at that
 *     time, so stage 2 can always place it (see scheduler/sectionPlanner.js).
 *
 * Strategy: for each unselected offering we scan (slot, professor) pairs in
 * canonical order and take the first feasible combination. A (batch, course)
 * slot cache makes subsequent students in the same batch reuse the same
 * section when possible (so the 72 students of Div-1 taking CS001 all land in
 * the same section). If the cached section is saturated, the next student
 * tries alternative (slot, professor) pairs — naturally creating overflow
 * sections when demand exceeds the first professor's capacity.
 *
 * Repair: when every instructor with seats left is busy at all of a
 * student's free times, a section keeping one of them busy is handed to
 * another eligible instructor free at that same time (students keep their
 * times), and the freed instructor takes the student.
 *
 * Students are processed least flexible batch first (fewest slot options
 * per course), so fixed-time cohorts are placed before free-choice ones.
 *
 * Elective baskets: a student who has not chosen an option in a basket gets
 * the option with the fewest students so far that can be placed whole
 * (theory and lab); a student who already chose one has it completed.
 */
export async function allotSlots({ termId = 'TERM_2026_ODD', semester = null, batchId = null } = {}) {
  const studentQ = {};
  if (batchId) studentQ.batchId = batchId;
  if (semester) studentQ.semester = Number(semester);
  const students = await Student.find(studentQ).lean();
  if (students.length === 0) return { created: 0, skipped: 0, failures: [], byCourse: {} };

  const batchIds = [...new Set(students.map((s) => s.batchId))];
  const [offerings, courses, slots, caps, existing, termRegs, rooms, professors] = await Promise.all([
    CourseOffering.find({ termId, batchId: { $in: batchIds } }).lean(),
    Course.find().lean(),
    Slot.find().lean(),
    ProfessorCapacity.find({ termId }).lean(),
    Registration.find({ termId, studentId: { $in: students.map((s) => s.studentId) } }).lean(),
    Registration.find({ termId }).lean(),
    Room.find().lean(),
    Professor.find().lean(),
  ]);
  // Built from every registration in the term, not just this cohort, so a
  // batch-scoped run still respects instructors and rooms used by others.
  const planner = createSectionPlanner({ courses, rooms, professors, registrations: termRegs });

  const offeringsByBatch = {};
  for (const o of offerings) (offeringsByBatch[o.batchId] ||= []).push(o);
  const courseById = Object.fromEntries(courses.map((c) => [c.courseId, c]));
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

  // (batch|course) → preferred (slot, prof) section. First student picks;
  // reused by subsequent students so a batch lands in the same section when
  // capacity allows.
  const sectionCache = {};

  /** Try each (slot, prof) pair in canonical order. Returns the first feasible
   *  combination or null. Caller mutates seats/occupancy on success. */
  function findFeasibleSection(student, course, batchId, offering) {
    const slotPool = slotsForOffering(offering, course, slots);
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
      // Least-loaded instructors first, so no one gets booked into every slot
      // and left unable to teach a course only they (and a few others) can.
      const byLoad = [...profIds].sort((a, b) => planner.instructorLoad(a) - planner.instructorLoad(b));
      const orderedProfs = cached && cached.slotCode === slot.slotCode
        ? [cached.professorId, ...byLoad.filter((p) => p !== cached.professorId)]
        : byLoad;
      for (const pid of orderedProfs) {
        const seats = seatsByKey[`${pid}|${course.courseId}`];
        if (!seats || seats.seatsUsed >= seats.maxStudents) continue;
        if (planner.instructorConflict(pid, course.courseId, slot.slotCode)) continue;
        if (!planner.roomsFit(course.courseId, slot.slotCode, pid)) continue;
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

  /** Hands a section created in this run to another instructor at the same time. */
  function moveSection(regs, section, from, to) {
    const n = regs.length;
    planner.add({ courseId: section.courseId, slotCode: section.slotCode, professorId: from }, -n);
    planner.add({ courseId: section.courseId, slotCode: section.slotCode, professorId: to }, n);
    const fromSeats = seatsByKey[`${from}|${section.courseId}`];
    const toSeats = seatsByKey[`${to}|${section.courseId}`];
    fromSeats.seatsUsed -= n; fromSeats._dirty = true;
    toSeats.seatsUsed += n; toSeats._dirty = true;
    for (const r of regs) r.professorId = to;
    for (const cached of Object.values(sectionCache)) {
      if (cached.slotCode === section.slotCode && cached.professorId === from && cached.courseId === section.courseId) {
        cached.professorId = to;
      }
    }
  }

  /** See "Repair" above. Returns { slot, professorId } with the instructor freed, or null. */
  function repairSection(student, course, offering) {
    const mySlots = (existingByStudent[student.studentId] || []).map((r) => slotByCode[r.slotCode]).filter(Boolean);
    for (const slot of slotsForOffering(offering, course, slots)) {
      if (mySlots.some((es) => slotsClash(es, slot))) continue;
      for (const pid of eligibleProfsByCourse[course.courseId] || []) {
        const seats = seatsByKey[`${pid}|${course.courseId}`];
        if (!seats || seats.seatsUsed >= seats.maxStudents) continue;
        const blocking = planner.blockingSections(pid, slot.slotCode);
        if (!blocking.length) continue;
        const moves = [];
        let ok = true;
        for (const section of blocking) {
          const regs = newRegs.filter((r) => r.courseId === section.courseId
            && r.slotCode === section.slotCode && r.professorId === pid);
          // Only sections made in this run can move; saved ones stay.
          const to = regs.length === section.size && (eligibleProfsByCourse[section.courseId] || []).find((q) => {
            const qs = seatsByKey[`${q}|${section.courseId}`];
            return q !== pid && qs && qs.maxStudents - qs.seatsUsed >= section.size
              && !planner.hasSection(section.courseId, section.slotCode, q)
              && !planner.instructorConflict(q, section.courseId, section.slotCode);
          });
          if (!to) { ok = false; break; }
          moveSection(regs, section, pid, to);
          moves.push({ regs, section, to });
        }
        if (ok && !planner.instructorConflict(pid, course.courseId, slot.slotCode)
          && planner.roomsFit(course.courseId, slot.slotCode, pid)) {
          return { slot, professorId: pid };
        }
        for (const m of moves.reverse()) moveSection(m.regs, m.section, m.to, pid);
      }
    }
    return null;
  }

  /** Places one offering for a student; returns the new registration or null. */
  function place(student, off) {
    const course = courseById[off.courseId];
    if (!course) {
      failures.push({ studentId: student.studentId, courseId: off.courseId, reason: 'course not found' });
      return null;
    }
    const pick = findFeasibleSection(student, course, student.batchId, off) || repairSection(student, course, off);
    if (!pick) return null;
    const seats = seatsByKey[`${pick.professorId}|${course.courseId}`];
    seats.seatsUsed += 1; seats._dirty = true;
    planner.add({ courseId: course.courseId, slotCode: pick.slot.slotCode, professorId: pick.professorId });
    (existingByStudent[student.studentId] ||= []).push({ courseId: off.courseId, slotCode: pick.slot.slotCode });
    const reg = {
      studentId: student.studentId,
      courseId: off.courseId,
      courseOfferingId: off.courseOfferingId,
      slotCode: pick.slot.slotCode,
      professorId: pick.professorId,
      termId,
      status: 'confirmed',
    };
    newRegs.push(reg);
    return reg;
  }

  /** Reverts registrations made by place(), newest first. */
  function undo(student, regs) {
    for (const reg of [...regs].reverse()) {
      seatsByKey[`${reg.professorId}|${reg.courseId}`].seatsUsed -= 1;
      planner.add(reg, -1);
      const mine = existingByStudent[student.studentId];
      mine.splice(mine.findIndex((r) => r.courseId === reg.courseId), 1);
      newRegs.splice(newRegs.indexOf(reg), 1);
    }
  }

  function commit(student, regs) {
    for (const reg of regs) {
      sectionCache[`${student.batchId}|${reg.courseId}`] = { courseId: reg.courseId, slotCode: reg.slotCode, professorId: reg.professorId };
      created += 1;
      byCourse[reg.courseId] = (byCourse[reg.courseId] || 0) + 1;
    }
  }

  // Students per elective option, so new choices spread across options.
  const optionLoad = {};
  const optionKey = (batchId, group, option) => `${batchId}|${group}|${option}`;
  const offeringByCourse = {};
  for (const o of offerings) offeringByCourse[`${o.batchId}|${o.courseId}`] = o;
  const studentById = Object.fromEntries(students.map((x) => [x.studentId, x]));
  for (const r of termRegs) {
    const st = studentById[r.studentId];
    const o = st && offeringByCourse[`${st.batchId}|${r.courseId}`];
    if (o?.electiveGroup && o.courseId === o.electiveOption) {
      const k = optionKey(o.batchId, o.electiveGroup, o.electiveOption);
      optionLoad[k] = (optionLoad[k] || 0) + 1;
    }
  }

  // Least flexible cohorts first: a batch whose courses run at fixed times
  // (Semester 7) cannot work around instructors another batch already took.
  const choices = {};
  for (const [bid, offs] of Object.entries(offeringsByBatch)) {
    const counts = offs.map((o) => slotsForOffering(o, courseById[o.courseId], slots).length);
    choices[bid] = counts.reduce((a, b) => a + b, 0) / Math.max(1, counts.length);
  }
  const ordered = [...students].sort((a, b) => (choices[a.batchId] ?? 0) - (choices[b.batchId] ?? 0));

  for (const student of ordered) {
    const { core, groups } = programmeStructure(offeringsByBatch[student.batchId] || []);
    const existingCourses = new Set((existingByStudent[student.studentId] || []).map((r) => r.courseId));

    for (const off of core) {
      if (existingCourses.has(off.courseId)) { skipped += 1; continue; }
      const reg = place(student, off);
      if (reg) commit(student, [reg]);
      else if (courseById[off.courseId]) {
        failures.push({ studentId: student.studentId, courseId: off.courseId, reason: 'no feasible slot+instructor' });
      }
    }

    for (const [group, options] of groups) {
      const chosen = [...options.entries()].filter(([, offs]) => offs.some((o) => existingCourses.has(o.courseId)));
      const candidates = chosen.length
        ? chosen
        : [...options.entries()].sort(([a], [b]) =>
          (optionLoad[optionKey(student.batchId, group, a)] || 0) - (optionLoad[optionKey(student.batchId, group, b)] || 0)
          || a.localeCompare(b));
      let placed = false;
      for (const [option, offs] of candidates) {
        const regs = [];
        let ok = true;
        for (const off of offs) {
          if (existingCourses.has(off.courseId)) { skipped += 1; continue; }
          const reg = place(student, off);
          if (!reg) { ok = false; break; }
          regs.push(reg);
        }
        if (ok) {
          commit(student, regs);
          if (!chosen.length) {
            const k = optionKey(student.batchId, group, option);
            optionLoad[k] = (optionLoad[k] || 0) + 1;
          }
          placed = true;
          break;
        }
        undo(student, regs);
      }
      if (!placed) {
        failures.push({ studentId: student.studentId, courseId: null, group, reason: `no option of ${group} could be placed` });
      }
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
