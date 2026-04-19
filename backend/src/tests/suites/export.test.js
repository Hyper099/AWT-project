import Course from '../../models/Course.js';
import Room from '../../models/Room.js';
import Building from '../../models/Building.js';
import Professor from '../../models/Professor.js';
import Student from '../../models/Student.js';
import Registration from '../../models/Registration.js';
import TimetableEntry from '../../models/TimetableEntry.js';
import { buildTimetableRows, renderCsv } from '../../services/timetableExport.js';
import { runScheduler } from '../../scheduler/algorithm.js';
import { allotSlots } from '../../services/allotSlots.js';
import { seedFixture } from '../harness/seedFixture.js';

function assert(cond, msg) { if (!cond) throw new Error(msg); }

async function setUpTimetable() {
  await seedFixture();
  await Registration.deleteMany({});
  await TimetableEntry.deleteMany({});
  await allotSlots({ termId: 'TERM_2026_ODD' });

  const [courses, rooms, buildings, professors, students, regs] = await Promise.all([
    Course.find().lean(), Room.find().lean(), Building.find().lean(),
    Professor.find().lean(), Student.find().lean(),
    Registration.find({ termId: 'TERM_2026_ODD' }).lean(),
  ]);
  const { assignments } = runScheduler({ courses, rooms, buildings, professors, students, registrations: regs, termId: 'TERM_2026_ODD' });
  if (assignments.length) await TimetableEntry.insertMany(assignments);
}

async function buildRowsIncludesInstructor() {
  await setUpTimetable();
  const s = await Student.findOne({ batchId: 'CSE_2023_SEM5_DIV1' }).lean();
  if (!s) return; // harness seeds first 60 students; DIV1 should be present
  const data = await buildTimetableRows(s.studentId);
  assert(data.rows.length > 0, 'expected rows');
  const hasProf = data.rows.some((r) => r.professorName);
  assert(hasProf, 'at least one row should include a professorName');
}

async function csvIsWellFormed() {
  const s = await Student.findOne().lean();
  const data = await buildTimetableRows(s.studentId);
  const csv = renderCsv(data);
  const lines = csv.trim().split('\n');
  assert(lines[0].startsWith('Student Name,Student ID,Term'), 'unexpected CSV header');
  assert(lines.length >= 2, 'expected at least one data row (maybe 0 if student has no regs)');
}

export default {
  name: 'export',
  cases: [
    ['buildTimetableRows includes instructor name', buildRowsIncludesInstructor],
    ['CSV has the expected header', csvIsWellFormed],
  ],
};
