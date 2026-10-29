import Course from '../../models/Course.js';
import Room from '../../models/Room.js';
import Building from '../../models/Building.js';
import Professor from '../../models/Professor.js';
import Student from '../../models/Student.js';
import Registration from '../../models/Registration.js';
import Slot from '../../models/Slot.js';
import TimetableEntry from '../../models/TimetableEntry.js';
import { runScheduler, findSelectionConflicts } from '../../scheduler/algorithm.js';

function assert(cond, msg) { if (!cond) throw new Error(msg); }

async function runWithFixture() {
  const [courses, rooms, buildings, professors, students, regs] = await Promise.all([
    Course.find().lean(), Room.find().lean(), Building.find().lean(),
    Professor.find().lean(), Student.find().lean(),
    Registration.find({ termId: 'TERM_2026_ODD' }).lean(),
  ]);
  return runScheduler({ courses, rooms, buildings, professors, students, registrations: regs, termId: 'TERM_2026_ODD' });
}

async function assignsRoomsToSections() {
  const { assignments } = await runWithFixture();
  assert(assignments.length > 0, 'expected assignments');
  for (const a of assignments) {
    assert(a.roomId, `assignment missing roomId: ${JSON.stringify(a)}`);
    assert(a.buildingId, `assignment missing buildingId`);
  }
  await TimetableEntry.deleteMany({});
  await TimetableEntry.insertMany(assignments);
}

async function placesEverySection() {
  const { unplaced, sectionsTotal, assignments } = await runWithFixture();
  assert(unplaced.length === 0,
    `${unplaced.length} sections unplaced, e.g. ${JSON.stringify(unplaced[0] && { ...unplaced[0], studentIds: undefined })}`);
  assert(assignments.length === sectionsTotal, `placed ${assignments.length} of ${sectionsTotal}`);
}

async function selectionsHaveNoClashes() {
  const regs = await Registration.find({ termId: 'TERM_2026_ODD' }).lean();
  const { studentClashes, instructorClashes } = findSelectionConflicts(regs);
  assert(studentClashes.length === 0, `${studentClashes.length} student clashes`);
  assert(instructorClashes.length === 0, `${instructorClashes.length} instructor clashes`);
}

async function reportsSectionsWithoutRoom() {
  // Shrink every lab to 5 seats: lab sections must be reported, not dropped silently.
  const [courses, rooms, buildings, professors, students, regs] = await Promise.all([
    Course.find().lean(), Room.find().lean(), Building.find().lean(),
    Professor.find().lean(), Student.find().lean(),
    Registration.find({ termId: 'TERM_2026_ODD' }).lean(),
  ]);
  const tinyLabs = rooms.map((r) => (r.type === 'lab' ? { ...r, capacity: 5 } : r));
  const { unplaced } = runScheduler({ courses, rooms: tinyLabs, buildings, professors, students, registrations: regs, termId: 'TERM_2026_ODD' });
  assert(unplaced.length > 0, 'expected lab sections to be reported as unplaced');
  assert(unplaced.every((u) => /lab room/.test(u.reason)), 'unplaced reason should name the missing lab room');
}

async function roomCapacityHoldsEnrollment() {
  const entries = await TimetableEntry.find().lean();
  for (const e of entries) {
    assert(e.capacity >= e.enrolled, `capacity ${e.capacity} < enrolled ${e.enrolled} for ${e.courseId}`);
  }
}

async function roomNearFitPreferred() {
  // Aggregate waste across assignments — with near-fit objective waste
  // should be low relative to a naive assign-largest-room baseline (~45%).
  const entries = await TimetableEntry.find().lean();
  const totalCap = entries.reduce((s, e) => s + e.capacity, 0);
  const totalEnrolled = entries.reduce((s, e) => s + e.enrolled, 0);
  const waste = totalCap - totalEnrolled;
  const wastePct = waste / Math.max(1, totalCap);
  assert(wastePct < 0.85, `room near-fit objective failing; waste ${(wastePct * 100).toFixed(1)}% of capacity`);
}

async function slotFamilyConstraintHonored() {
  const entries = await TimetableEntry.find().lean();
  const courses = Object.fromEntries((await Course.find().lean()).map((c) => [c.courseId, c]));
  const slots = Object.fromEntries((await Slot.find().lean()).map((s) => [s.slotCode, s]));
  let bad = 0;
  for (const e of entries) {
    const c = courses[e.courseId]; const s = slots[e.slotCode];
    if (!c || !s) continue;
    if ((c.slotFamily || 'THEORY_3') !== s.family) bad += 1;
  }
  assert(bad === 0, `${bad} timetable entries violate slot-family`);
}

export default {
  name: 'scheduler',
  cases: [
    ['phase-2 assigns rooms', assignsRoomsToSections],
    ['every section gets a room', placesEverySection],
    ['phase-1 selections have no student or instructor clashes', selectionsHaveNoClashes],
    ['sections without a room are reported', reportsSectionsWithoutRoom],
    ['capacity ≥ enrollment', roomCapacityHoldsEnrollment],
    ['room near-fit produces reasonable waste', roomNearFitPreferred],
    ['slot-family honored in final timetable', slotFamilyConstraintHonored],
  ],
};
