import Student from '../models/Student.js';
import Registration from '../models/Registration.js';
import { sendMail, mailerMode } from './mailer.js';

/**
 * Sends a "timetable allotted" notification to every student who has at least
 * one registration in the given term. Returns counts (sent/failed/skipped).
 */
export async function notifyStudents(termId = 'TERM_2026_ODD') {
  const regs = await Registration.find({ termId }).lean();
  const studentIds = [...new Set(regs.map((r) => r.studentId))];
  if (studentIds.length === 0) return { sent: 0, failed: 0, skipped: 0, mode: mailerMode() };

  const students = await Student.find({ studentId: { $in: studentIds } }).lean();
  const appUrl = process.env.APP_URL || 'http://localhost:5173';

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  const tasks = students.map(async (s) => {
    if (!s.email) { skipped += 1; return; }
    const subject = `Your timetable for ${termId} is ready`;
    const text = [
      `Hello ${s.name || s.studentId},`,
      '',
      `Your timetable for ${termId} has been allotted.`,
      `Log in to the portal to view and download it:`,
      appUrl,
      '',
      '— Campus Timetable Office',
    ].join('\n');
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; color:#0a0a0a; max-width:560px;">
        <h2 style="margin:0 0 8px; font-weight:600;">Your timetable is ready</h2>
        <p style="color:#525252; margin:0 0 16px;">Term ${termId}</p>
        <p>Hello ${s.name || s.studentId},</p>
        <p>Your timetable for <strong>${termId}</strong> has been allotted. Log in to the portal to view and download your schedule.</p>
        <p><a href="${appUrl}" style="display:inline-block; padding:10px 16px; background:#0a0a0a; color:#fff; text-decoration:none;">Open portal</a></p>
        <p style="color:#525252; font-size:12px; margin-top:32px;">Campus Timetable Office</p>
      </div>
    `;
    const res = await sendMail({ to: s.email, subject, text, html });
    if (res.ok) sent += 1;
    else failed += 1;
  });
  await Promise.allSettled(tasks);

  return { sent, failed, skipped, mode: mailerMode() };
}
