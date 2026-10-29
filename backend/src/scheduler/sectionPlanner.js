import { buildClashIndex } from './slots.js';

/**
 * Tracks sections — one (course, slot, instructor) group of students — while
 * registrations are being created, so stage 1 never produces a plan that
 * stage 2 cannot give rooms to.
 *
 * Shared by the automatic allocator (allotSlots) and manual registration.
 *
 *   instructorConflict  instructor is unavailable, already teaching another
 *                       course in this slot, or teaching in an overlapping slot
 *   roomsFit            after adding one student, every section that can run
 *                       at the same time as this slot still gets its own room
 *                       of the right type and size
 */

export function roomKind(course) {
  return course && (course.requiresLabRoom || course.type === 'lab') ? 'lab' : 'theory';
}

/**
 * Sizes fit distinct rooms iff, with both lists sorted descending, the i-th
 * largest section fits the i-th largest room.
 */
export function roomsCanHold(sizes, capacitiesDesc) {
  if (sizes.length > capacitiesDesc.length) return false;
  const sorted = [...sizes].sort((a, b) => b - a);
  return sorted.every((size, i) => size <= capacitiesDesc[i]);
}

export function createSectionPlanner({ courses, rooms, professors = [], registrations = [] }) {
  const clashIdx = buildClashIndex();
  const courseById = Object.fromEntries(courses.map((c) => [c.courseId, c]));
  const profById = Object.fromEntries(professors.map((p) => [p.professorId, p]));
  const capacities = { lab: [], theory: [] };
  for (const r of rooms) capacities[r.type === 'lab' ? 'lab' : 'theory'].push(r.capacity);
  capacities.lab.sort((a, b) => b - a);
  capacities.theory.sort((a, b) => b - a);

  const sectionSize = new Map(); // `${courseId}|${slotCode}|${professorId}` → students
  const sectionsBySlot = new Map(); // slotCode → Set(sectionKey)
  const profSlots = new Map(); // professorId → Map(slotCode → Set(courseId))

  const keyOf = (courseId, slotCode, professorId) => `${courseId}|${slotCode}|${professorId}`;
  const neighbourhood = (slotCode) => [slotCode, ...(clashIdx[slotCode] || [])];

  function add({ courseId, slotCode, professorId }, delta = 1) {
    if (!professorId) return;
    const key = keyOf(courseId, slotCode, professorId);
    const size = (sectionSize.get(key) || 0) + delta;
    if (size <= 0) {
      sectionSize.delete(key);
      sectionsBySlot.get(slotCode)?.delete(key);
      const bySlot = profSlots.get(professorId);
      bySlot?.get(slotCode)?.delete(courseId);
      if (bySlot?.get(slotCode)?.size === 0) bySlot.delete(slotCode);
      return;
    }
    sectionSize.set(key, size);
    if (!sectionsBySlot.has(slotCode)) sectionsBySlot.set(slotCode, new Set());
    sectionsBySlot.get(slotCode).add(key);
    if (!profSlots.has(professorId)) profSlots.set(professorId, new Map());
    const bySlot = profSlots.get(professorId);
    if (!bySlot.has(slotCode)) bySlot.set(slotCode, new Set());
    bySlot.get(slotCode).add(courseId);
  }

  for (const r of registrations) add(r);

  /** Returns a human-readable reason, or null when the instructor is free. */
  function instructorConflict(professorId, courseId, slotCode) {
    const prof = profById[professorId];
    const unavailable = new Set(prof?.unavailableSlots || []);
    if (neighbourhood(slotCode).some((s) => unavailable.has(s))) {
      return 'instructor is unavailable at this time';
    }
    const bySlot = profSlots.get(professorId);
    if (!bySlot) return null;
    const sameSlot = bySlot.get(slotCode);
    if (sameSlot && [...sameSlot].some((c) => c !== courseId)) {
      return 'instructor is teaching another course at this time';
    }
    for (const other of clashIdx[slotCode] || []) {
      if (bySlot.get(other)?.size) return 'instructor is teaching another class at an overlapping time';
    }
    return null;
  }

  function roomsFit(courseId, slotCode, professorId) {
    const kind = roomKind(courseById[courseId]);
    const target = keyOf(courseId, slotCode, professorId);
    const sizes = [];
    let found = false;
    for (const s of neighbourhood(slotCode)) {
      for (const key of sectionsBySlot.get(s) || []) {
        if (roomKind(courseById[key.split('|')[0]]) !== kind) continue;
        let size = sectionSize.get(key);
        if (key === target) { size += 1; found = true; }
        sizes.push(size);
      }
    }
    if (!found) sizes.push(1);
    return roomsCanHold(sizes, capacities[kind]);
  }

  /** Number of distinct slots the instructor already teaches in. */
  function instructorLoad(professorId) {
    return profSlots.get(professorId)?.size || 0;
  }

  /** Largest section a single room of the course's type can hold. */
  function maxSectionSize(courseId) {
    return capacities[roomKind(courseById[courseId])][0] || 0;
  }

  /** The instructor's sections at this slot or an overlapping one: what keeps them busy then. */
  function blockingSections(professorId, slotCode) {
    const out = [];
    for (const s of neighbourhood(slotCode)) {
      for (const courseId of profSlots.get(professorId)?.get(s) || []) {
        out.push({ courseId, slotCode: s, professorId, size: sectionSize.get(keyOf(courseId, s, professorId)) || 0 });
      }
    }
    return out;
  }

  /** True when the instructor already has a section of this course in this slot. */
  function hasSection(courseId, slotCode, professorId) {
    return sectionSize.has(keyOf(courseId, slotCode, professorId));
  }

  return { add, instructorConflict, roomsFit, instructorLoad, maxSectionSize, blockingSections, hasSection };
}
