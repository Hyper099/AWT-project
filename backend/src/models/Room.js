import mongoose from 'mongoose';

const RoomSchema = new mongoose.Schema(
  {
    roomId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    buildingId: { type: String, required: true, index: true },
    floor: { type: Number, default: 0 },
    capacity: { type: Number, required: true },
    /** `theory` for lectures/seminars/auditoriums; `lab` for labs. */
    type: { type: String, enum: ['theory', 'lab'], default: 'theory', index: true },
    roomType: { type: String, default: 'lecture' },
    hasProjector: { type: Boolean, default: true },
    hasLabEquipment: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.model('Room', RoomSchema);
