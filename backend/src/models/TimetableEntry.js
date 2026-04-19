import mongoose from 'mongoose';

/**
 * One entry per (course, section, slotCode) assignment after scheduling.
 * Expansion to per-meeting rows can be derived from Slot.meetings.
 */
const TimetableEntrySchema = new mongoose.Schema(
  {
    termId: { type: String, required: true, index: true },
    courseId: { type: String, required: true, index: true },
    sectionId: { type: String, required: true, index: true },
    slotCode: { type: String, required: true, index: true },
    roomId: { type: String, required: true, index: true },
    buildingId: { type: String, required: true, index: true },
    professorId: { type: String, required: true, index: true },
    enrolled: { type: Number, default: 0 },
    capacity: { type: Number, default: 0 },
  },
  { timestamps: true }
);

TimetableEntrySchema.index({ termId: 1, roomId: 1, slotCode: 1 }, { unique: true });
TimetableEntrySchema.index({ termId: 1, professorId: 1, slotCode: 1 }, { unique: true });

export default mongoose.model('TimetableEntry', TimetableEntrySchema);
