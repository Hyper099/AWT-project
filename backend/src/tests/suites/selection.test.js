import Registration from '../../models/Registration.js';
import Student from '../../models/Student.js';
import CourseOffering from '../../models/CourseOffering.js';
import ProfessorCapacity from '../../models/ProfessorCapacity.js';
import { seedFixture } from '../harness/seedFixture.js';

function assert(cond, msg) { if (!cond) throw new Error(msg); }

/**
 * We call the student routes directly by invoking the underlying mongoose
 * operations — focussed on the business rules (seat decrement + slot family).
 */

async function registerDecrementsSeat() {
  await Registration.deleteMany({});
  await ProfessorCapacity.updateMany({}, { $set: { seatsUsed: 0 } });

  const cap = await ProfessorCapacity.findOne({ courseId: 'CS004' }).lean();
  const before = cap.seatsUsed;

  const claim = await ProfessorCapacity.findOneAndUpdate(
    { professorId: cap.professorId, courseId: cap.courseId, termId: cap.termId, $expr: { $lt: ['$seatsUsed', '$maxStudents'] } },
    { $inc: { seatsUsed: 1 } },
    { new: true },
  );
  assert(claim, 'expected seat claim to succeed');
  assert(claim.seatsUsed === before + 1, 'seatsUsed should increment by 1');
}

async function seatClaimRefusesWhenFull() {
  await ProfessorCapacity.updateOne(
    { courseId: 'CS004' },
    [{ $set: { seatsUsed: '$maxStudents' } }],
  );
  const cap = await ProfessorCapacity.findOne({ courseId: 'CS004' }).lean();
  const claim = await ProfessorCapacity.findOneAndUpdate(
    { professorId: cap.professorId, courseId: cap.courseId, termId: cap.termId, $expr: { $lt: ['$seatsUsed', '$maxStudents'] } },
    { $inc: { seatsUsed: 1 } },
    { new: true },
  );
  assert(claim === null, 'seat claim must refuse when already at capacity');
}

async function dropRefundsSeat() {
  // Reset
  await Registration.deleteMany({});
  await ProfessorCapacity.updateMany({}, { $set: { seatsUsed: 1 } });
  const cap = await ProfessorCapacity.findOne({ courseId: 'CS004' }).lean();
  await ProfessorCapacity.updateOne(
    { professorId: cap.professorId, courseId: cap.courseId, termId: cap.termId },
    { $inc: { seatsUsed: -1 } },
  );
  const after = await ProfessorCapacity.findOne({ _id: cap._id }).lean();
  assert(after.seatsUsed === 0, 'drop should decrement seatsUsed to 0');
}

async function offeringsResolveForStudent() {
  // Re-seed to reset mutations from earlier test cases
  await seedFixture();
  const s = await Student.findOne().lean();
  const offs = await CourseOffering.find({ termId: 'TERM_2026_ODD', batchId: s.batchId }).lean();
  assert(offs.length >= 3, `expected at least 3 offerings for ${s.batchId}, got ${offs.length}`);
}

export default {
  name: 'selection',
  cases: [
    ['seat claim increments atomically', registerDecrementsSeat],
    ['seat claim refuses when full', seatClaimRefusesWhenFull],
    ['drop refunds seat', dropRefundsSeat],
    ['offerings resolve per-student batch', offeringsResolveForStudent],
  ],
};
