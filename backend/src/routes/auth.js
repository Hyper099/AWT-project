import { asyncRouter, optionalString, requireString } from '../middleware/asyncRouter.js';
import User from '../models/User.js';
import Student from '../models/Student.js';
import Professor from '../models/Professor.js';
import { signToken } from '../middleware/auth.js';

const router = asyncRouter();

router.post('/signup', async (req, res) => {
  const body = req.body || {};
  const username = requireString(body, 'username');
  const password = requireString(body, 'password');
  const role = requireString(body, 'role');
  const displayName = requireString(body, 'displayName');
  const email = optionalString(body, 'email');
  if (!['student', 'professor'].includes(role)) return res.status(400).json({ error: 'invalid role' });

  const exists = await User.findOne({ username: username.toLowerCase() });
  if (exists) return res.status(409).json({ error: 'username taken' });

  // An ID that already has an account cannot be claimed again; otherwise
  // anyone could sign up as an existing student and change their courses.
  let studentId;
  let professorId;
  if (role === 'student') {
    studentId = requireString(body, 'studentId');
    const s = await Student.findOne({ studentId });
    if (!s) return res.status(404).json({ error: 'student record not found' });
    if (await User.exists({ studentId })) {
      return res.status(409).json({ error: 'an account already exists for this student ID; sign in instead' });
    }
  } else {
    professorId = requireString(body, 'professorId');
    const p = await Professor.findOne({ professorId });
    if (!p) return res.status(404).json({ error: 'professor record not found' });
    if (await User.exists({ professorId })) {
      return res.status(409).json({ error: 'an account already exists for this instructor ID; sign in instead' });
    }
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
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return res.status(400).json({ error: 'username and password required' });
  }
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
