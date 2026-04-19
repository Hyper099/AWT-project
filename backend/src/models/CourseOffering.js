import mongoose from 'mongoose';

/**
 * A course offering is what a given batch is permitted to register for in a
 * given term. Students see the offerings for their batch on the portal.
 */
const CourseOfferingSchema = new mongoose.Schema(
  {
    courseOfferingId: { type: String, required: true, unique: true, index: true },
    termId: { type: String, required: true, index: true },
    courseId: { type: String, required: true, index: true },
    batchId: { type: String, required: true, index: true },
    expectedEnrollment: { type: Number, default: 60 },
    isElective: { type: Boolean, default: false },
    minSections: { type: Number, default: 1 },
    maxSections: { type: Number, default: 1 },
    specialRoomRequirement: { type: String, default: 'Lecture' },
    status: { type: String, enum: ['open', 'closed', 'full'], default: 'open' },
  },
  { timestamps: true }
);

CourseOfferingSchema.index({ termId: 1, batchId: 1, courseId: 1 }, { unique: true });

export default mongoose.model('CourseOffering', CourseOfferingSchema);
