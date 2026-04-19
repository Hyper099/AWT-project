import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const UserSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
    email: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['student', 'professor', 'admin'], required: true, index: true },
    displayName: { type: String, required: true },
    studentId: { type: String, index: true, sparse: true },
    professorId: { type: String, index: true, sparse: true },
  },
  { timestamps: true }
);

UserSchema.methods.verifyPassword = function (plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

UserSchema.statics.hashPassword = function (plain) {
  return bcrypt.hash(plain, 10);
};

export default mongoose.model('User', UserSchema);
