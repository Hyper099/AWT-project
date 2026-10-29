import mongoose from 'mongoose';

const MeetingSchema = new mongoose.Schema(
  {
    day: { type: String, enum: ['MON', 'TUE', 'WED', 'THU', 'FRI'], required: true },
    startMinute: { type: Number, required: true },
    endMinute: { type: Number, required: true },
  },
  { _id: false }
);

/**
 * A Slot is a named bundle of meeting times. `family` drives the hard
 * credit→slot compatibility rule (a 3-credit theory course can only use
 * slots in THEORY_3) within the course's semester.
 */
const SlotSchema = new mongoose.Schema(
  {
    slotCode: { type: String, required: true, unique: true, index: true },
    type: { type: String, enum: ['theory', 'lab'], default: 'theory', index: true },
    family: {
      type: String,
      enum: ['THEORY_3', 'THEORY_2', 'THEORY_1', 'LAB_2', 'LAB_1'],
      index: true,
    },
    meetings: { type: [MeetingSchema], required: true },
    /** Each semester has its own timetable grid; a slot belongs to one. */
    semester: { type: Number, default: 5, index: true },
  },
  { timestamps: true }
);

export default mongoose.model('Slot', SlotSchema);
