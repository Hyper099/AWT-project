#!/usr/bin/env node
/**
 * Checks the seeded term without changing it: every student holds a complete
 * programme, selections have no student or instructor clashes and respect
 * instructor unavailability, and a dry run
 * of the room scheduler places every section. Exits non-zero on any problem.
 *
 * Usage: npm run audit   (each semester is checked in its own term)
 */
import 'dotenv/config';
import { connectDB, disconnectDB } from '../config/db.js';
import Building from '../models/Building.js';
import Course from '../models/Course.js';
import Professor from '../models/Professor.js';
import Registration from '../models/Registration.js';
import Room from '../models/Room.js';
import Semester from '../models/Semester.js';
import Student from '../models/Student.js';
import { findSelectionConflicts, runScheduler } from '../scheduler/algorithm.js';
import { buildClashIndex } from '../scheduler/slots.js';
import { cohortStatus } from '../services/adminStatus.js';

async function main() {
  await connectDB(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/vtop_system');

  const problems = [];
  const [semesters, courses, rooms, buildings, professors, students] = await Promise.all([
    Semester.find().sort({ semester: 1 }).lean(), Course.find().lean(), Room.find().lean(),
    Building.find().lean(), Professor.find().lean(), Student.find().lean(),
  ]);

  // Each semester runs in its own term, with its own rooms and instructors.
  for (const sem of semesters) {
    const termId = sem.termId;
    const registrations = await Registration.find({ termId }).lean();
    const { totals } = await cohortStatus({ termId, semester: sem.semester });
    console.log(`[audit] ${sem.name}: ${totals.students} students, ${totals.fullySelected} complete, `
      + `${totals.partial} in progress, ${totals.none} not started`);
    if (totals.students === 0) problems.push(`${sem.name} has no students`);
    if (totals.partial || totals.none) problems.push(`${sem.name}: ${totals.partial + totals.none} students without a complete programme`);

  const { studentClashes, instructorClashes } = findSelectionConflicts(registrations);
  console.log(`[audit]   ${termId} clashes: ${studentClashes.length} student, ${instructorClashes.length} instructor`);
  for (const c of instructorClashes.slice(0, 10)) console.log(`        ${c.professorId}: ${c.courses.join(' / ')} in ${c.slots.join(' / ')}`);
  if (studentClashes.length) problems.push(`${studentClashes.length} student clashes`);
  if (instructorClashes.length) problems.push(`${instructorClashes.length} instructor clashes`);

  // Instructors booked at a time they marked unavailable (same or overlapping slot).
  const clashIdx = buildClashIndex();
  const unavailable = Object.fromEntries(professors.map((p) => [p.professorId, new Set(p.unavailableSlots || [])]));
  const badTimes = new Set();
  for (const r of registrations) {
    const off = unavailable[r.professorId];
    if (off && [r.slotCode, ...(clashIdx[r.slotCode] || [])].some((s) => off.has(s))) badTimes.add(`${r.professorId} ${r.courseId}@${r.slotCode}`);
  }
  console.log(`[audit] sections at an instructor's unavailable time: ${badTimes.size}`);
  for (const b of [...badTimes].slice(0, 10)) console.log(`        ${b}`);
  if (badTimes.size) problems.push(`${badTimes.size} sections at an instructor's unavailable time`);

  const { assignments, unplaced, sectionsTotal } = runScheduler({
    courses, rooms, buildings, professors, students, registrations, termId,
  });
  const bySem = {};
  for (const a of assignments) bySem[a.semester] = (bySem[a.semester] || 0) + 1;
  console.log(`[audit] dry run placed ${assignments.length} of ${sectionsTotal} sections `
    + `(${Object.entries(bySem).map(([s, n]) => `Sem ${s}: ${n}`).join(', ')})`);
  for (const u of unplaced.slice(0, 10)) console.log(`        unplaced ${u.courseId}/${u.slotCode}/${u.professorId}: ${u.reason}`);
  if (unplaced.length) problems.push(`${unplaced.length} sections without a room`);

  }

  await disconnectDB();
  if (problems.length) {
    console.error(`[audit] FAILED: ${problems.join('; ')}`);
    process.exit(1);
  }
  console.log('[audit] OK');
}

main().catch((err) => { console.error(err); process.exit(1); });
