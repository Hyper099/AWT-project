import { Router } from 'express';
import User from '../models/User.js';
import Student from '../models/Student.js';
import Professor from '../models/Professor.js';
import { signToken } from '../middleware/auth.js';

const router = Router();

router.post('/signup', async (req, res) => {
  const { username, password, role, displayName, studentId, professorId, email } = req.body || {};
  if (!username || !password || !role || !displayName) {
    return res.status(400).json({ error: 'username, password, role, displayName required' });
  }
  if (!['student', 'professor'].includes(role)) return res.status(400).json({ error: 'invalid role' });

  const exists = await User.findOne({ username: username.toLowerCase() });
  if (exists) return res.status(409).json({ error: 'username taken' });

  if (role === 'student') {
    if (!studentId) return res.status(400).json({ error: 'studentId required' });
    const s = await Student.findOne({ studentId });
    if (!s) return res.status(404).json({ error: 'student record not found' });
  } else {
    if (!professorId) return res.status(400).json({ error: 'professorId required' });
    const p = await Professor.findOne({ professorId });
    if (!p) return res.status(404).json({ error: 'professor record not found' });
  }

  const passwordHash = await User.hashPassword(password);
  const user = await User.create({
    username: username.toLowerCase(),
    email,
    passwordHash,
    role,
    displayName,
    studentId,
    professorId,
  });
  const token = signToken(user);
  res.status(201).json({ token, user: sanitize(user) });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  const user = await User.findOne({ username: username.toLowerCase() });
  if (!user) return res.status(401).json({ error: 'invalid credentials' });
  const ok = await user.verifyPassword(password);
  if (!ok) return res.status(401).json({ error: 'invalid credentials' });
  const token = signToken(user);
  res.json({ token, user: sanitize(user) });
});

function sanitize(u) {
  return {
    id: u._id, username: u.username, role: u.role, displayName: u.displayName,
    studentId: u.studentId, professorId: u.professorId, email: u.email,
  };
}

export default router;
