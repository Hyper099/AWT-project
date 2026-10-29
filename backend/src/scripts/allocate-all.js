#!/usr/bin/env node
/**
 * Resets the term (or one semester) and runs the phase-1 allocator for every
 * student in scope, picking slots + professors automatically. Other
 * semesters' selections stay and are worked around. Useful for demos.
 *
 * Usage:
 *   node src/scripts/allocate-all.js --term TERM_2026_ODD
 *   node src/scripts/allocate-all.js --term TERM_2026_ODD --no-reset
 *   node src/scripts/allocate-all.js --semester 5
 */
import 'dotenv/config';
import { connectDB, disconnectDB } from '../config/db.js';
import { resetAllocation } from '../services/adminReset.js';
import { allotSlots } from '../services/allotSlots.js';

async function main() {
  const args = process.argv.slice(2);
  const termIdx = args.indexOf('--term');
  const termId = termIdx >= 0 ? args[termIdx + 1] : 'TERM_2026_ODD';
  const noReset = args.includes('--no-reset');
  const semIdx = args.indexOf('--semester');
  const semester = semIdx >= 0 ? Number(args[semIdx + 1]) : null;
  const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/vtop_system';
  await connectDB(uri);
  if (!noReset) {
    const r = await resetAllocation({ termId, semester });
    console.log('[allocate-all] reset ->', r);
  }
  const out = await allotSlots({ termId, semester });
  console.log(`[allocate-all] created=${out.created} skipped=${out.skipped} failures=${out.failures.length}`);
  if (out.failures.length) console.log('[allocate-all] first failures:', out.failures.slice(0, 5));
  await disconnectDB();
}
main().catch((err) => { console.error(err); process.exit(1); });
