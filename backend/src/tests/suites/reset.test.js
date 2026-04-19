import Registration from '../../models/Registration.js';
import TimetableEntry from '../../models/TimetableEntry.js';
import ProfessorCapacity from '../../models/ProfessorCapacity.js';
import { resetSelections, resetAllocation } from '../../services/adminReset.js';
import { allotSlots } from '../../services/allotSlots.js';
import { seedFixture } from '../harness/seedFixture.js';

function assert(cond, msg) { if (!cond) throw new Error(msg); }

async function resetSelectionsRefundsSeats() {
  await seedFixture();
  await Registration.deleteMany({});
  await ProfessorCapacity.updateMany({}, { $set: { seatsUsed: 0 } });
  await allotSlots({ termId: 'TERM_2026_ODD' });

  const before = await Registration.countDocuments();
  assert(before > 0, 'expected registrations before reset');

  const r = await resetSelections({ termId: 'TERM_2026_ODD' });
  assert(r.deleted === before, `expected deleted=${before}, got ${r.deleted}`);

  const caps = await ProfessorCapacity.find().lean();
  const anyNonZero = caps.find((c) => c.seatsUsed !== 0);
  assert(!anyNonZero, `expected all seatsUsed to reset, still found: ${anyNonZero?.professorId}/${anyNonZero?.courseId} used=${anyNonZero?.seatsUsed}`);
}

async function resetAllocationClearsEntriesAndSelections() {
  await seedFixture();
  await Registration.deleteMany({});
  await TimetableEntry.deleteMany({});
  await ProfessorCapacity.updateMany({}, { $set: { seatsUsed: 0 } });
  await allotSlots({ termId: 'TERM_2026_ODD' });
  await TimetableEntry.insertMany([{ termId: 'TERM_2026_ODD', courseId: 'CS001', sectionId: 'CS001-S1', slotCode: 'A1', roomId: 'A101', buildingId: 'A1', professorId: 'P2', enrolled: 10, capacity: 50 }]);

  const r = await resetAllocation({ termId: 'TERM_2026_ODD' });
  assert(r.selectionsDeleted > 0, 'expected deleted selections');
  assert(r.entriesDeleted >= 1, 'expected deleted timetable entries');

  const entries = await TimetableEntry.countDocuments();
  assert(entries === 0, 'no timetable entries should remain');
  const caps = await ProfessorCapacity.find().lean();
  assert(caps.every((c) => c.seatsUsed === 0), 'all seatsUsed must be zero');
}

async function resetSelectionsScopedToStudent() {
  await seedFixture();
  await Registration.deleteMany({});
  await ProfessorCapacity.updateMany({}, { $set: { seatsUsed: 0 } });
  await allotSlots({ termId: 'TERM_2026_ODD' });

  const one = await Registration.findOne().lean();
  assert(one, 'need at least one registration');
  const before = await Registration.countDocuments();
  const r = await resetSelections({ termId: 'TERM_2026_ODD', studentId: one.studentId });
  assert(r.deleted > 0, `expected some deleted for ${one.studentId}`);
  const after = await Registration.countDocuments();
  assert(after === before - r.deleted, 'only scoped rows should be removed');
}

export default {
  name: 'reset',
  cases: [
    ['resetSelections refunds all seats', resetSelectionsRefundsSeats],
    ['resetAllocation clears selections + entries', resetAllocationClearsEntriesAndSelections],
    ['resetSelections respects student scope', resetSelectionsScopedToStudent],
  ],
};
