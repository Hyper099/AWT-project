import mongoose from 'mongoose';

const BuildingSchema = new mongoose.Schema(
  {
    buildingId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    campusName: { type: String, default: 'Main Campus' },
    // Legacy fallback coordinates. Authoritative distances come from
    // data/csv/building_distances.csv loaded via scheduler/distance.js.
    x: { type: Number, default: 0 },
    y: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model('Building', BuildingSchema);
