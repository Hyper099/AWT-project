import mongoose from 'mongoose';

const CourseSchema = new mongoose.Schema(
  {
    courseId: { type: String, required: true, unique: true, index: true },
    code: { type: String, required: true, index: true },
    title: { type: String, required: true },
    department: { type: String, required: true, index: true },
    credits: { type: Number, required: true },
    weeklyHours: { type: Number, required: true },
    type: { type: String, enum: ['theory', 'lab', 'project'], default: 'theory' },
    /** Hard constraint: course may only be scheduled in slots whose family matches. */
    slotFamily: {
      type: String,
      enum: ['THEORY_3', 'THEORY_2', 'THEORY_1', 'LAB_2', 'LAB_1'],
      default: 'THEORY_3',
      index: true,
    },
    courseTypeCategory: { type: String, default: 'Core' },
    semester: { type: Number, default: 5 },
    program: { type: String, default: 'BTech' },
    expectedEnrollment: { type: Number, default: 60 },
    isElective: { type: Boolean, default: false },
    requiresLabRoom: { type: Boolean, default: false },
    roomTypeRequired: { type: String, default: 'Lecture' },
    preferredBuilding: String,
  },
  { timestamps: true }
);

export default mongoose.model('Course', CourseSchema);
