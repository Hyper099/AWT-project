import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { connectDB } from './config/db.js';
import authRoutes from './routes/auth.js';
import studentRoutes from './routes/student.js';
import professorRoutes from './routes/professor.js';
import courseRoutes from './routes/courses.js';
import schedulerRoutes from './routes/scheduler.js';
import adminRoutes from './routes/admin.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/auth', authRoutes);
app.use('/courses', courseRoutes);
app.use('/student', studentRoutes);
app.use('/professor', professorRoutes);
app.use('/scheduler', schedulerRoutes);
app.use('/admin', adminRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'server error' });
});

const port = process.env.PORT || 5050;
const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/vtop_system';

connectDB(uri)
  .then(() => app.listen(port, () => console.log(`[api] listening on :${port}`)))
  .catch((err) => {
    console.error('failed to start', err);
    process.exit(1);
  });
