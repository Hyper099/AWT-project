import 'dotenv/config';
import { connectDB, disconnectDB } from '../config/db.js';
import Course from '../models/Course.js';
import Room from '../models/Room.js';
import Building from '../models/Building.js';
import Professor from '../models/Professor.js';
import Student from '../models/Student.js';
import Registration from '../models/Registration.js';
import TimetableEntry from '../models/TimetableEntry.js';
import { runScheduler, findSelectionConflicts } from './algorithm.js';

async function main() {
  const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/vtop_system';
  await connectDB(uri);

  const termId = process.argv[2] || 'TERM_2026_ODD';
  console.log(`[scheduler] running for term: ${termId}`);

  const [courses, rooms, buildings, professors, students, registrations] = await Promise.all([
    Course.find().lean(),
    Room.find().lean(),
    Building.find().lean(),
    Professor.find().lean(),
    Student.find().lean(),
    Registration.find({ termId }).lean(),
  ]);

  console.log(`  courses=${courses.length} rooms=${rooms.length} buildings=${buildings.length} profs=${professors.length}`);
  console.log(`  students=${students.length} registrations=${registrations.length}`);

  const { studentClashes, instructorClashes } = findSelectionConflicts(registrations);
  if (studentClashes.length || instructorClashes.length) {
    console.warn(`[scheduler] input has ${studentClashes.length} student clashes and ${instructorClashes.length} instructor clashes`);
  }

  const { assignments, score, unplaced, sectionsTotal } = runScheduler({
    courses, rooms, buildings, professors, students, registrations, termId,
  });

  console.log(`[scheduler] placed ${assignments.length} of ${sectionsTotal} sections. score=${score.total.toFixed(2)}`);
  console.log('  components:', score.components);
  for (const u of unplaced) {
    console.log(`  unplaced: ${u.courseId}/${u.slotCode}/${u.professorId} (${u.studentIds.length} students): ${u.reason}`);
  }

  // Persist: wipe this term's entries and insert fresh
  await TimetableEntry.deleteMany({ termId });
  if (assignments.length) await TimetableEntry.insertMany(assignments);
  console.log('[scheduler] persisted.');

  await disconnectDB();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
