#!/usr/bin/env node
/**
 * De-allocates everything for a term: clears Registrations, TimetableEntries,
 * and resets ProfessorCapacity.seatsUsed to zero. Does NOT delete base data
 * (students, courses, offerings, professors).
 *
 * Usage:
 *   node src/scripts/reset-allocation.js --term TERM_2026_ODD
 */
import 'dotenv/config';
import { connectDB, disconnectDB } from '../config/db.js';
import { resetAllocation } from '../services/adminReset.js';

async function main() {
  const args = process.argv.slice(2);
  const termIdx = args.indexOf('--term');
  const termId = termIdx >= 0 ? args[termIdx + 1] : 'TERM_2026_ODD';
  const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/vtop_system';
  await connectDB(uri);
  const result = await resetAllocation({ termId });
  console.log('[reset-allocation]', result);
  await disconnectDB();
}
main().catch((err) => { console.error(err); process.exit(1); });
