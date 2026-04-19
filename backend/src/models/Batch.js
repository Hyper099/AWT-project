import mongoose from 'mongoose';

const BatchSchema = new mongoose.Schema(
  {
    batchId: { type: String, required: true, unique: true, index: true },
    batchName: String,
    departmentId: { type: String, index: true },
    semester: { type: Number, index: true },
    strength: Number,
    programName: String,
    sectionName: String,
    academicYear: String,
    branchName: String,
    groupSet: String,
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model('Batch', BatchSchema);
