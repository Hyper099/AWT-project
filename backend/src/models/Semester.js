import mongoose from 'mongoose';

const PeriodSchema = new mongoose.Schema(
  {
    periodNo: { type: Number, required: true },
    startMinute: { type: Number, required: true },
    endMinute: { type: Number, required: true },
    /** `class` periods take bookings; `lunch` is a fixed break for the whole semester. */
    kind: { type: String, enum: ['class', 'lunch'], default: 'class' },
  },
  { _id: false }
);

/**
 * A semester cohort running in a term (e.g. Semester 5 and Semester 7 both
 * run in the odd term). Each has its own bell schedule, used to draw grids.
 */
const SemesterSchema = new mongoose.Schema(
  {
    semester: { type: Number, required: true, unique: true, index: true },
    name: { type: String, required: true },
    termId: { type: String, index: true },
    creditsRequired: { type: Number, default: 0 },
    timetableSource: String,
    periods: { type: [PeriodSchema], default: [] },
  },
  { timestamps: true }
);

export default mongoose.model('Semester', SemesterSchema);
