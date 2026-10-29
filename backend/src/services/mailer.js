import nodemailer from 'nodemailer';

let cachedTransport = null;
let cachedMode = null;

function buildTransport() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (host && user && pass) {
    const transport = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || 'false') === 'true',
      auth: { user, pass },
    });
    return { transport, mode: 'smtp' };
  }

  // Dev fallback: log-only transport (MAIL_LOG=off silences it, e.g. in tests). Returns a resolved "info" so callers don't break.
  const transport = {
    sendMail: async (opts) => {
      if (process.env.MAIL_LOG === 'off') return { messageId: `dev-${Date.now()}` };
      const line = `[mail:dev] to=${opts.to} subject="${opts.subject}"`;
      console.log(line);
      if (opts.text) console.log(`[mail:dev]   ${opts.text.replace(/\n/g, '\n[mail:dev]   ')}`);
      return { messageId: `dev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
    },
    verify: async () => true,
  };
  return { transport, mode: 'console' };
}

function getTransport() {
  if (!cachedTransport) {
    const { transport, mode } = buildTransport();
    cachedTransport = transport;
    cachedMode = mode;
    console.log(`[mailer] mode=${mode}`);
  }
  return cachedTransport;
}

export function mailerMode() {
  if (!cachedMode) getTransport();
  return cachedMode;
}

export async function sendMail({ to, subject, text, html }) {
  if (!to) return { skipped: true, reason: 'no recipient' };
  const transport = getTransport();
  const from = process.env.MAIL_FROM || 'Campus Timetable <no-reply@campus.local>';
  try {
    const info = await transport.sendMail({ from, to, subject, text, html });
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[mailer] send failed to=${to}:`, err.message);
    return { ok: false, error: err.message };
  }
}
