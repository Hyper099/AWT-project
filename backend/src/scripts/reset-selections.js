#!/usr/bin/env node
/**
 * Usage:
 *   node src/scripts/reset-selections.js                    # all students, default term
 *   node src/scripts/reset-selections.js --term TERM_2026_ODD
 *   node src/scripts/reset-selections.js --student 23BCP001
 *   node src/scripts/reset-selections.js --batch CSE_2023_SEM5_DIV3
 *   node src/scripts/reset-selections.js --semester 7
 */
import 'dotenv/config';
import { connectDB, disconnectDB } from '../config/db.js';
import { resetSelections } from '../services/adminReset.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { termId: 'TERM_2026_ODD', studentId: null, batchId: null, semester: null };
  for (let i = 0; i < args.length; i++) {
    const k = args[i];
    const v = args[i + 1];
    if (k === '--term') { out.termId = v; i++; }
    else if (k === '--student') { out.studentId = v; i++; }
    else if (k === '--batch') { out.batchId = v; i++; }
    else if (k === '--semester') { out.semester = Number(v); i++; }
  }
  return out;
}

async function main() {
  const opts = parseArgs();
  const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/vtop_system';
  await connectDB(uri);
  const result = await resetSelections(opts);
  console.log('[reset-selections]', result);
  await disconnectDB();
}
main().catch((err) => { console.error(err); process.exit(1); });
