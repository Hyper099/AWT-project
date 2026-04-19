import mongoose from 'mongoose';

/**
 * Phase-1 record: the student (or admin on their behalf) has selected a course
 * in a given slot with a given professor. Seat capacity for the (professor,
 * course) pair is decremented when created and refunded when deleted.
 * Phase-2 (room/building scheduling) reads these and produces TimetableEntry rows.
 */
const RegistrationSchema = new mongoose.Schema(
  {
    studentId: { type: String, required: true, index: true },
    courseId: { type: String, required: true, index: true },
    courseOfferingId: { type: String, index: true },
    slotCode: { type: String, required: true, index: true },
    professorId: { type: String, index: true },
    termId: { type: String, required: true, index: true },
    status: { type: String, enum: ['pending', 'confirmed', 'waitlist', 'dropped'], default: 'confirmed' },
  },
  { timestamps: true }
);

RegistrationSchema.index({ studentId: 1, courseId: 1, termId: 1 }, { unique: true });

export default mongoose.model('Registration', RegistrationSchema);
