import mongoose from 'mongoose';

const ProfessorSchema = new mongoose.Schema(
  {
    professorId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    department: { type: String, required: true, index: true },
    email: String,
    // Slot identifiers the professor prefers (soft) or cannot teach in (hard)
    preferredSlots: [{ type: String }],
    unavailableSlots: [{ type: String }],
    // Max teaching load (hours per week)
    maxHoursPerWeek: { type: Number, default: 16 },
    // Home building for professor travel tie-breaks
    homeBuilding: { type: String },
    // Courses the professor is eligible/selected to teach
    eligibleCourses: [{ type: String }],
    teachingCourses: [{ type: String }],
  },
  { timestamps: true }
);

export default mongoose.model('Professor', ProfessorSchema);
