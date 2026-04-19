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
 */
export function runScheduler({ courses, rooms, buildings, professors, students, registrations, termId }) {
  const clashIdx = buildClashIndex();
  const courseById = Object.fromEntries(courses.map((c) => [c.courseId, c]));
  const roomsByType = { theory: [], lab: [] };
  for (const r of rooms) roomsByType[r.type].push(r);
  const buildingsById = Object.fromEntries(buildings.map((b) => [b.buildingId, b]));

  // Group registrations into sections keyed by (courseId|slotCode|professorId).
  // Registrations without an assigned professor are not schedulable here
  // (phase-1 failed to allot them); we skip them and surface them in status.
  const sectionMap = new Map();
  let skippedNoProf = 0;
  for (const reg of registrations) {
    if (!reg.professorId) { skippedNoProf += 1; continue; }
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
  if (skippedNoProf) console.warn(`[scheduler] ${skippedNoProf} registrations skipped (no professor assigned)`);
  const sections = [...sectionMap.values()];

  // Hardest-first ordering: largest cohorts and lab courses get rooms first.
  sections.sort((a, b) => {
    const ca = courseById[a.courseId];
    const cb = courseById[b.courseId];
    const labBias = ((cb?.type === 'lab') - (ca?.type === 'lab'));
    if (labBias !== 0) return labBias;
    return b.studentIds.length - a.studentIds.length;
  });

  const roomSlotBusy = new Map(); // `${roomId}|${slotCode}` → true (plus clashers)
  const markBusy = (key) => roomSlotBusy.set(key, true);
  const isBusy = (key) => roomSlotBusy.has(key);
  const markSlotGroup = (roomId, slotCode) => {
    markBusy(`${roomId}|${slotCode}`);
    for (const c of clashIdx[slotCode] || []) markBusy(`${roomId}|${c}`);
  };

  const assignments = [];

  for (const sec of sections) {
    const course = courseById[sec.courseId];
    if (!course) continue;
    const slot = SLOT_BY_CODE[sec.slotCode];
    if (!slot) continue;

    // Slot-family hard constraint: course.slotFamily must match slot.family.
    if (course.slotFamily && slot.family && course.slotFamily !== slot.family) {
      console.warn(`[scheduler] slot-family mismatch: ${course.courseId} (${course.slotFamily}) ≠ slot ${slot.slotCode} (${slot.family})`);
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
      console.warn(`[scheduler] no feasible room for ${sec.courseId}/${sec.slotCode} (enrolled=${enrolled})`);
      continue;
    }
    cands.sort((a, b) => a.cost - b.cost);
    const pick = cands[0];

    markSlotGroup(pick.room.roomId, sec.slotCode);
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
      _studentIds: sec.studentIds,
    };
    assignments.push(asg);
  }

  // Strip internal _studentIds before returning
  const cleanAssignments = assignments.map(({ _studentIds, ...a }) => a);
  const score = scoreTimetable({
    assignments: cleanAssignments, students, registrations, rooms, buildings, professors,
  });
  return { assignments: cleanAssignments, score };
}
