import mongoose from 'mongoose';

const TermSchema = new mongoose.Schema(
  {
    termId: { type: String, required: true, unique: true, index: true },
    termName: { type: String, required: true },
    startDate: String,
    endDate: String,
    /** planning → registration_open → selection_closed → allotment_complete */
    status: { type: String, default: 'planning' },
    registrationOpen: { type: Boolean, default: true },
    schedulingLocked: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model('Term', TermSchema);
