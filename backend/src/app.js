import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.js';
import studentRoutes from './routes/student.js';
import professorRoutes from './routes/professor.js';
import courseRoutes from './routes/courses.js';
import semesterRoutes from './routes/semesters.js';
import schedulerRoutes from './routes/scheduler.js';
import adminRoutes from './routes/admin.js';

/** The HTTP API, without a database connection or a listening port (tests mount it directly). */
export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/auth', authRoutes);
  app.use('/courses', courseRoutes);
  app.use('/semesters', semesterRoutes);
  app.use('/student', studentRoutes);
  app.use('/professor', professorRoutes);
  app.use('/scheduler', schedulerRoutes);
  app.use('/admin', adminRoutes);

  app.use((err, _req, res, _next) => {
    if (!err.status || err.status >= 500) console.error(err);
    res.status(err.status || 500).json({ error: err.message || 'server error' });
  });
  return app;
}
