import mongoose from 'mongoose';

const StudentSchema = new mongoose.Schema(
  {
    studentId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    department: { type: String, required: true, index: true },
    batchId: { type: String, required: true, index: true },
    division: String,
    group: String,
    semester: { type: Number, required: true },
    program: String,
    branch: String,
    email: String,
    status: { type: String, default: 'active' },
    creditsRequired: { type: Number, default: 20 },
  },
  { timestamps: true }
);

export default mongoose.model('Student', StudentSchema);
