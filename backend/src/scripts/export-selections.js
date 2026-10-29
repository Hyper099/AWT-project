#!/usr/bin/env node
/**
 * Writes the term's current registrations to data/csv/student_course_selections.csv
 * so the seed reproduces them. Typical use, after fixing data or rules:
 *
 *   npm run allocate-all          # rebuild clash-free selections in the DB
 *   npm run export-selections     # save them as the seed's starting point
 *
 * With --semester N only that semester's rows are rewritten; rows for other
 * students are kept exactly as they are in the file.
 *
 * Usage: node src/scripts/export-selections.js --term TERM_2026_ODD [--semester 5]
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { connectDB, disconnectDB } from '../config/db.js';
import Registration from '../models/Registration.js';
import Student from '../models/Student.js';
import { dataDir, readCsv } from '../seed/csvLoader.js';

const HEADER = [
  'student_id', 'term_id', 'course_offering_id', 'course_id', 'professor_id',
  'slot_code', 'selection_type', 'priority_rank', 'submission_timestamp',
];

async function main() {
  const args = process.argv.slice(2);
  const termIdx = args.indexOf('--term');
  const termId = termIdx >= 0 ? args[termIdx + 1] : 'TERM_2026_ODD';
  const semIdx = args.indexOf('--semester');
  const semester = semIdx >= 0 ? Number(args[semIdx + 1]) : null;
  await connectDB(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/vtop_system');

  // Keep the seed's order: students as listed in students.csv, then their
  // registrations in creation order.
  const [students, allRegs] = await Promise.all([
    Student.find(semester ? { semester } : {}).lean(),
    Registration.find({ termId }).sort({ _id: 1 }).lean(),
  ]);
  const order = new Map(students.map((s, i) => [s.studentId, i]));
  const regs = allRegs.filter((r) => order.has(r.studentId));
  regs.sort((a, b) => (order.get(a.studentId) ?? 0) - (order.get(b.studentId) ?? 0));

  const file = path.join(dataDir(), 'student_course_selections.csv');
  const kept = semester ? readCsv(dataDir(), 'student_course_selections.csv').filter((r) => !order.has(r.student_id)) : [];
  const start = Date.parse('2026-04-15T09:00:00Z');
  const lines = [HEADER.join(',')];
  regs.forEach((r, i) => {
    const ts = new Date(start + i * 1000).toISOString().slice(0, 19);
    lines.push([
      r.studentId, r.termId, r.courseOfferingId || '', r.courseId, r.professorId || '',
      r.slotCode, 'student_choice', 1, ts,
    ].join(','));
  });

  for (const r of kept) lines.push(HEADER.map((h) => r[h] ?? '').join(','));
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  console.log(`[export-selections] wrote ${regs.length} rows (kept ${kept.length} others) to ${file}`);
  await disconnectDB();
}

main().catch((err) => { console.error(err); process.exit(1); });
