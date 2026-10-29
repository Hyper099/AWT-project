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
    /** One batch per term: Semester 5 last year, Semester 7 now. `batchId`/`semester` above are the latest. */
    enrolments: {
      type: [{
        termId: String, semester: Number, batchId: String, division: String, group: String, _id: false,
      }],
      default: [],
    },
  },
  { timestamps: true }
);

StudentSchema.index({ 'enrolments.termId': 1 });

export default mongoose.model('Student', StudentSchema);
