import { createSectionPlanner, roomsCanHold } from '../../scheduler/sectionPlanner.js';

function assert(cond, msg) { if (!cond) throw new Error(msg); }

// Slot catalogue from time_slots.csv: C1 = Mon/Wed/Fri 11:00–12:00,
// LJ = Wed 11:00–13:00 (overlaps C1), A1 = Mon/Wed/Fri 09:00–10:00.
const courses = [
  { courseId: 'T1', type: 'theory', slotFamily: 'THEORY_3' },
  { courseId: 'T2', type: 'theory', slotFamily: 'THEORY_3' },
  { courseId: 'L1', type: 'lab', requiresLabRoom: true, slotFamily: 'LAB_1' },
];
const rooms = [
  { roomId: 'R60', type: 'theory', capacity: 60 },
  { roomId: 'LAB40', type: 'lab', capacity: 40 },
  { roomId: 'LAB30', type: 'lab', capacity: 30 },
];

async function packingRule() {
  assert(roomsCanHold([40, 30], [40, 30]), 'exact fit should pass');
  assert(!roomsCanHold([41], [40, 30]), 'section larger than every room should fail');
  assert(!roomsCanHold([20, 20, 20], [40, 30]), 'more sections than rooms should fail');
}

async function instructorOverlapDetected() {
  const planner = createSectionPlanner({
    courses, rooms,
    professors: [{ professorId: 'P', unavailableSlots: ['A1'] }],
    registrations: [{ courseId: 'T1', slotCode: 'C1', professorId: 'P' }],
  });
  assert(planner.instructorConflict('P', 'T1', 'C1') === null, 'same section is not a conflict');
  assert(planner.instructorConflict('P', 'T2', 'C1'), 'different course in same slot is a conflict');
  assert(planner.instructorConflict('P', 'L1', 'LJ'), 'overlapping slot (C1 vs LJ) is a conflict');
  assert(planner.instructorConflict('P', 'T2', 'A1'), 'unavailable slot is a conflict');
}

async function roomCapacityTracked() {
  const planner = createSectionPlanner({ courses, rooms, registrations: [] });
  for (let i = 0; i < 40; i++) {
    assert(planner.roomsFit('L1', 'LJ', 'P'), `student ${i + 1} should fit`);
    planner.add({ courseId: 'L1', slotCode: 'LJ', professorId: 'P' });
  }
  assert(!planner.roomsFit('L1', 'LJ', 'P'), '41st student must not fit the largest lab (40)');
  assert(planner.roomsFit('L1', 'LJ', 'Q'), 'a second section can use the 30-seat lab');
}

export default {
  name: 'sectionPlanner',
  cases: [
    ['rooms-can-hold packing rule', packingRule],
    ['instructor conflicts include overlapping slots', instructorOverlapDetected],
    ['section size is capped by free rooms', roomCapacityTracked],
  ],
};
