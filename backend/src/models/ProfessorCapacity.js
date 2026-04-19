import mongoose from 'mongoose';

/**
 * Per (professor, course) seat capacity. Source of truth for how many
 * students may select a given professor for a given course.
 * `seatsUsed` is tracked live and decremented at registration time.
 */
const ProfessorCapacitySchema = new mongoose.Schema(
  {
    professorId: { type: String, required: true, index: true },
    courseId: { type: String, required: true, index: true },
    termId: { type: String, required: true, index: true, default: 'TERM_2026_ODD' },
    maxStudents: { type: Number, required: true },
    seatsUsed: { type: Number, default: 0 },
    maxSections: { type: Number, default: 1 },
    priority: { type: Number, default: 1 },
  },
  { timestamps: true }
);

ProfessorCapacitySchema.index({ professorId: 1, courseId: 1, termId: 1 }, { unique: true });

export default mongoose.model('ProfessorCapacity', ProfessorCapacitySchema);
