import { SLOT_BY_CODE, getSlotCatalog, buildClashIndex } from './slots.js';
import { scoreTimetable } from './cost.js';
import { buildingDistance } from './distance.js';

/**
 * PHASE-2 SCHEDULER — room/building assignment only.
 *
 * Inputs: registrations already carry (slotCode, professorId). This function
 * groups registrations into sections (course, slot, professor) and assigns
 * a room to each, respecting:
 *   Hard constraints
 *     - Room type matches course (lab course → lab room; theory → lecture).
 *     - Room capacity ≥ enrolled count.
 *     - No two sections share (room, slotCode) or clashing slot pair.
 *   Objectives (lower cost wins)
 *     - Room near-fit: prefer the smallest feasible room (within +50% tolerance).
 *     - Student travel distance (from building_distances.csv).
 *     - Professor preferred slot hit.
 *
 * `preBooked` holds timetable entries that stay as they are (another
 * semester's published sections): their rooms and instructors are treated as
 * busy at those times, since semesters share both.
 */
export function runScheduler({ courses, rooms, buildings, professors, students, registrations, termId, preBooked = [] }) {
  const clashIdx = buildClashIndex();
  const courseById = Object.fromEntries(courses.map((c) => [c.courseId, c]));
  const roomsByType = { theory: [], lab: [] };
  for (const r of rooms) roomsByType[r.type].push(r);
  const buildingsById = Object.fromEntries(buildings.map((b) => [b.buildingId, b]));

  // Group registrations into sections keyed by (courseId|slotCode|professorId).
  // Every section that cannot be placed is recorded in `unplaced` with a
  // reason, so callers can report an incomplete timetable instead of hiding it.
  const sectionMap = new Map();
  const unplaced = [];
  const noProf = registrations.filter((r) => !r.professorId);
  if (noProf.length) {
    unplaced.push({
      courseId: null, slotCode: null, professorId: null,
      studentIds: noProf.map((r) => r.studentId),
      reason: 'registration has no instructor',
    });
  }
  for (const reg of registrations) {
    if (!reg.professorId) continue;
    const key = `${reg.courseId}|${reg.slotCode}|${reg.professorId}`;
    if (!sectionMap.has(key)) {
      sectionMap.set(key, {
        courseId: reg.courseId,
        slotCode: reg.slotCode,
        professorId: reg.professorId,
        studentIds: [],
      });
    }
    sectionMap.get(key).studentIds.push(reg.studentId);
  }
  const sections = [...sectionMap.values()];

  // Hardest-first ordering: largest cohorts and lab courses get rooms first.
  sections.sort((a, b) => {
    const ca = courseById[a.courseId];
    const cb = courseById[b.courseId];
    const labBias = ((cb?.type === 'lab') - (ca?.type === 'lab'));
    if (labBias !== 0) return labBias;
    return b.studentIds.length - a.studentIds.length;
  });

  // Instructor occupancy: a second section for the same instructor in the
  // same or an overlapping slot is rejected (stage 1 should prevent this, but
  // data imported from CSV is not guaranteed to be clean).
  const profSlotBusy = new Set(); // `${professorId}|${slotCode}`
  const roomSlotBusy = new Map(); // `${roomId}|${slotCode}` → true (plus clashers)
  const markBusy = (key) => roomSlotBusy.set(key, true);
  const isBusy = (key) => roomSlotBusy.has(key);
  const markSlotGroup = (roomId, slotCode) => {
    markBusy(`${roomId}|${slotCode}`);
    for (const c of clashIdx[slotCode] || []) markBusy(`${roomId}|${c}`);
  };

  for (const e of preBooked) {
    markSlotGroup(e.roomId, e.slotCode);
    profSlotBusy.add(`${e.professorId}|${e.slotCode}`);
    for (const c of clashIdx[e.slotCode] || []) profSlotBusy.add(`${e.professorId}|${c}`);
  }

  const assignments = [];

  for (const sec of sections) {
    const skip = (reason) => unplaced.push({ ...sec, reason });
    const course = courseById[sec.courseId];
    if (!course) { skip('unknown course'); continue; }
    const slot = SLOT_BY_CODE[sec.slotCode];
    if (!slot) { skip('unknown slot'); continue; }

    // Slot-family hard constraint: course.slotFamily must match slot.family.
    if (course.slotFamily && slot.family && course.slotFamily !== slot.family) {
      skip(`slot ${slot.slotCode} (${slot.family}) does not match course family ${course.slotFamily}`);
      continue;
    }
    if (profSlotBusy.has(`${sec.professorId}|${sec.slotCode}`)) {
      skip('instructor already teaching at this time');
      continue;
    }

    const enrolled = sec.studentIds.length;
    const wantLab = course.requiresLabRoom || course.type === 'lab';
    const pool = (wantLab ? roomsByType.lab : roomsByType.theory).filter((r) => r.capacity >= enrolled);

    // Score each feasible room: near-fit (waste) + travel from nearby students' previously-assigned buildings.
    const recentByStudent = new Map();
    for (const a of assignments) {
      for (const sid of a._studentIds || []) recentByStudent.set(sid, a.buildingId);
    }

    const cands = [];
    for (const room of pool) {
      if (isBusy(`${room.roomId}|${sec.slotCode}`)) continue;
      const waste = Math.max(0, room.capacity - enrolled);
      // Aggregate travel penalty from previous sections for shared students.
      let travel = 0;
      for (const sid of sec.studentIds) {
        const prev = recentByStudent.get(sid);
        if (!prev || prev === room.buildingId) continue;
        travel += buildingDistance(buildingsById[prev], buildingsById[room.buildingId]);
      }
      const cost = waste * 2 + travel * 0.01;
      cands.push({ room, cost, waste, travel });
    }
    if (!cands.length) {
      skip(`no free ${wantLab ? 'lab' : 'lecture'} room with ${enrolled}+ seats`);
      continue;
    }
    cands.sort((a, b) => a.cost - b.cost);
    const pick = cands[0];

    markSlotGroup(pick.room.roomId, sec.slotCode);
    profSlotBusy.add(`${sec.professorId}|${sec.slotCode}`);
    for (const c of clashIdx[sec.slotCode] || []) profSlotBusy.add(`${sec.professorId}|${c}`);
    const asg = {
      termId,
      courseId: sec.courseId,
      sectionId: `${sec.courseId}-${sec.slotCode}-${sec.professorId}`,
      slotCode: sec.slotCode,
      roomId: pick.room.roomId,
      buildingId: pick.room.buildingId,
      professorId: sec.professorId,
      enrolled,
      capacity: pick.room.capacity,
      semester: course.semester,
      _studentIds: sec.studentIds,
    };
    assignments.push(asg);
  }

  // Strip internal _studentIds before returning
  const cleanAssignments = assignments.map(({ _studentIds, ...a }) => a);
  const score = scoreTimetable({
    assignments: cleanAssignments, students, registrations, rooms, buildings, professors,
  });
  if (unplaced.length) {
    const regs = unplaced.reduce((n, u) => n + u.studentIds.length, 0);
    console.warn(`[scheduler] ${unplaced.length} sections (${regs} registrations) could not be placed`);
  }
  return { assignments: cleanAssignments, score, unplaced, sectionsTotal: sections.length };
}

/**
 * Hard-constraint violations already present in stage-1 selections: pairs of
 * a student's courses whose slots overlap, and instructors booked into
 * overlapping slots for different sections.
 */
export function findSelectionConflicts(registrations) {
  const clashIdx = buildClashIndex();
  const overlaps = (a, b) => a === b || clashIdx[a]?.has(b);

  const byStudent = {};
  for (const r of registrations) (byStudent[r.studentId] ||= []).push(r);
  const studentClashes = [];
  for (const [studentId, regs] of Object.entries(byStudent)) {
    for (let i = 0; i < regs.length; i++) {
      for (let j = i + 1; j < regs.length; j++) {
        if (overlaps(regs[i].slotCode, regs[j].slotCode)) {
          studentClashes.push({ studentId, courses: [regs[i].courseId, regs[j].courseId], slots: [regs[i].slotCode, regs[j].slotCode] });
        }
      }
    }
  }

  const sectionsByProf = {};
  const seen = new Set();
  for (const r of registrations) {
    if (!r.professorId) continue;
    const key = `${r.courseId}|${r.slotCode}|${r.professorId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    (sectionsByProf[r.professorId] ||= []).push(r);
  }
  const instructorClashes = [];
  for (const [professorId, secs] of Object.entries(sectionsByProf)) {
    for (let i = 0; i < secs.length; i++) {
      for (let j = i + 1; j < secs.length; j++) {
        if (overlaps(secs[i].slotCode, secs[j].slotCode)) {
          instructorClashes.push({ professorId, courses: [secs[i].courseId, secs[j].courseId], slots: [secs[i].slotCode, secs[j].slotCode] });
        }
      }
    }
  }
  return { studentClashes, instructorClashes };
}
