import Registration from '../../models/Registration.js';
import ProfessorCapacity from '../../models/ProfessorCapacity.js';
import Slot from '../../models/Slot.js';
import Course from '../../models/Course.js';
import { allotSlots } from '../../services/allotSlots.js';
import { seedFixture } from '../harness/seedFixture.js';

function assert(cond, msg) { if (!cond) throw new Error(msg); }

async function allotsMissingSelections() {
  await seedFixture();
  // Start from a clean slate
  await Registration.deleteMany({});
  await ProfessorCapacity.updateMany({}, { $set: { seatsUsed: 0 } });

  const result = await allotSlots({ termId: 'TERM_2026_ODD' });
  assert(result.created > 0, `expected creations, got ${result.created}`);
  const count = await Registration.countDocuments();
  assert(count === result.created, 'registration count should match created count');
}

async function respectsSlotFamily() {
  const regs = await Registration.find().lean();
  const slots = Object.fromEntries((await Slot.find().lean()).map((s) => [s.slotCode, s]));
  const courses = Object.fromEntries((await Course.find().lean()).map((c) => [c.courseId, c]));
  let bad = 0;
  for (const r of regs) {
    const slot = slots[r.slotCode];
    const course = courses[r.courseId];
    if (!slot || !course) continue;
    if ((course.slotFamily || 'THEORY_3') !== slot.family) bad += 1;
  }
  assert(bad === 0, `slot-family mismatch on ${bad} registrations`);
}

async function seatCountsMatchRegistrations() {
  const regs = await Registration.find().lean();
  const expected = {};
  for (const r of regs) {
    if (!r.professorId) continue;
    expected[`${r.professorId}|${r.courseId}`] = (expected[`${r.professorId}|${r.courseId}`] || 0) + 1;
  }
  const caps = await ProfessorCapacity.find().lean();
  for (const c of caps) {
    const expectedUsed = expected[`${c.professorId}|${c.courseId}`] || 0;
    assert(c.seatsUsed === expectedUsed,
      `seat mismatch for ${c.professorId}/${c.courseId}: db=${c.seatsUsed} vs computed=${expectedUsed}`);
  }
}

async function skipsAlreadySelected() {
  const before = await Registration.countDocuments();
  const result = await allotSlots({ termId: 'TERM_2026_ODD' });
  assert(result.created === 0, `expected 0 creations on second run, got ${result.created}`);
  const after = await Registration.countDocuments();
  assert(after === before, 'registration count should not change');
}

export default {
  name: 'allotSlots',
  cases: [
    ['phase-1 allocates missing selections', allotsMissingSelections],
    ['respects slot-family constraint', respectsSlotFamily],
    ['seat counters match registrations', seatCountsMatchRegistrations],
    ['second run is idempotent', skipsAlreadySelected],
  ],
};
