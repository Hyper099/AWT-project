#!/usr/bin/env node
/**
 * Minimal integration test suite. Uses a dedicated database (vtop_system_test)
 * so it never touches dev data. Each test file exports `{ name, run }`.
 *
 * Usage: npm test
 */
import 'dotenv/config';
import { connectDB, disconnectDB } from '../config/db.js';

process.env.JWT_SECRET ||= 'test-secret';
process.env.MAIL_LOG ||= 'off';

const TEST_URI = process.env.TEST_MONGO_URI
  || 'mongodb://127.0.0.1:27017/vtop_system_test';

const testFiles = [
  './suites/seed.test.js',
  './suites/selection.test.js',
  './suites/planner.test.js',
  './suites/allotSlots.test.js',
  './suites/scheduler.test.js',
  './suites/reset.test.js',
  './suites/export.test.js',
  './suites/semester.test.js',
  './suites/api.test.js',
];

let pass = 0, fail = 0;
const failures = [];

async function main() {
  await connectDB(TEST_URI);

  // Seed once; most suites rely on it.
  const seedMod = await import('./harness/seedFixture.js');
  console.log('[test] seeding fixture DB ...');
  await seedMod.seedFixture();

  for (const f of testFiles) {
    const mod = await import(f);
    const suite = mod.default;
    console.log(`\n▸ ${suite.name}`);
    for (const [name, fn] of suite.cases) {
      process.stdout.write(`  · ${name} `);
      try {
        await fn();
        process.stdout.write('✓\n');
        pass += 1;
      } catch (e) {
        process.stdout.write('✗\n');
        console.error(`      ${e.message}`);
        if (e.stack) console.error(e.stack.split('\n').slice(1, 3).join('\n'));
        failures.push({ suite: suite.name, test: name, err: e });
        fail += 1;
      }
    }
  }

  await disconnectDB();
  console.log(`\n${pass} passed · ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error('\n[test] harness crashed:', err);
  process.exit(1);
});
