import 'dotenv/config';
import { connectDB, disconnectDB } from '../config/db.js';
import Batch from '../models/Batch.js';
import Building from '../models/Building.js';
import Course from '../models/Course.js';
import CourseOffering from '../models/CourseOffering.js';
import Professor from '../models/Professor.js';
import ProfessorCapacity from '../models/ProfessorCapacity.js';
import Registration from '../models/Registration.js';
import Room from '../models/Room.js';
import Slot from '../models/Slot.js';
import Student from '../models/Student.js';
import Term from '../models/Term.js';
import TimetableEntry from '../models/TimetableEntry.js';
import User from '../models/User.js';
import { resetDistanceMatrix } from '../scheduler/distance.js';
import { getSlotCatalog, resetSlotCache } from '../scheduler/slots.js';
import { dataDir, readCsv } from './csvLoader.js';

function numOr(val, def) {
  const n = Number(val);
  return Number.isFinite(n) ? n : def;
}

async function main() {
  const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/vtop_system';
  await connectDB(uri);
  resetSlotCache();
  resetDistanceMatrix();

  console.log('[seed] wiping collections...');
  await Promise.all([
    User.deleteMany({}), Student.deleteMany({}), Professor.deleteMany({}),
    Course.deleteMany({}), Room.deleteMany({}), Building.deleteMany({}),
    Slot.deleteMany({}), Registration.deleteMany({}), TimetableEntry.deleteMany({}),
    CourseOffering.deleteMany({}), ProfessorCapacity.deleteMany({}),
    Term.deleteMany({}), Batch.deleteMany({}),
  ]);

  const DIR = dataDir();
  console.log(`[seed] reading CSVs from ${DIR}`);

  // ---------------- Buildings ----------------
  const buildings = readCsv(DIR, 'buildings.csv', { required: true }).map((r) => ({
    buildingId: r.building_id,
    name: r.building_name,
    campusName: r.campus_name || 'Main Campus',
    x: 0, y: 0,
  }));
  await Building.insertMany(buildings);

  // ---------------- Rooms ----------------
  const rooms = readCsv(DIR, 'rooms.csv', { required: true }).map((r) => {
    const isLab = (r.room_type || '').toLowerCase() === 'lab';
    return {
      roomId: r.room_id,
      name: r.room_name || r.room_id,
      buildingId: r.building_id,
      floor: numOr(r.floor_number, 0),
      capacity: numOr(r.capacity, 60),
      type: isLab ? 'lab' : 'theory',
      roomType: r.room_type || 'lecture',
      hasProjector: String(r.has_projector || '').toLowerCase() === 'yes',
      hasLabEquipment: String(r.has_lab_equipment || '').toLowerCase() === 'yes',
    };
  });
  await Room.insertMany(rooms);

  // ---------------- Time slots ----------------
  const slots = getSlotCatalog();
  await Slot.insertMany(slots);
  console.log(`[seed] buildings=${buildings.length} rooms=${rooms.length} slots=${slots.length}`);

  // ---------------- Courses ----------------
  const courseRows = readCsv(DIR, 'courses.csv', { required: true });
  const courses = courseRows.map((r) => ({
    courseId: r.course_id,
    code: r.course_code || r.course_id,
    title: r.course_title,
    department: r.department_id || 'CSE',
    credits: numOr(r.credits, 3),
    weeklyHours: numOr(r.weekly_hours, 3),
    type: r.course_type === 'lab' ? 'lab' : 'theory',
    slotFamily: r.slot_family || 'THEORY_3',
    courseTypeCategory: r.course_type_category || 'Core',
    semester: 5,
    expectedEnrollment: numOr(r.expected_enrollment, 60),
    isElective: String(r.course_type_category || '').toLowerCase().startsWith('open'),
    requiresLabRoom: String(r.needs_lab || '').toLowerCase() === 'yes',
    roomTypeRequired: r.room_type_required || 'Lecture',
  }));
  await Course.insertMany(courses);

  // ---------------- Professors + eligibility ----------------
  const profRows = readCsv(DIR, 'professors.csv', { required: true });
  const eligRows = readCsv(DIR, 'professor_course_eligibility.csv');
  const availRows = readCsv(DIR, 'professor_availability.csv');

  const eligByProf = {};
  for (const e of eligRows) {
    (eligByProf[e.professor_id] ||= []).push(e.course_id);
  }
  const availByProf = { preferred: {}, unavailable: {} };
  for (const a of availRows) {
    const key = a.availability_type;
    if (key !== 'preferred' && key !== 'unavailable') continue;
    (availByProf[key][a.professor_id] ||= []).push(a.slot_code || a.time_slot_id);
  }

  const professors = profRows.map((r) => ({
    professorId: r.professor_id,
    name: r.professor_name || r.professor_id,
    department: r.department_id || 'CSE',
    email: `${String(r.professor_id).toLowerCase()}@faculty.scheduler.local`,
    maxHoursPerWeek: numOr(r.max_weekly_load, 12),
    homeBuilding: '',
    eligibleCourses: eligByProf[r.professor_id] || [],
    teachingCourses: eligByProf[r.professor_id] || [],
    preferredSlots: availByProf.preferred[r.professor_id] || [],
    unavailableSlots: availByProf.unavailable[r.professor_id] || [],
  }));
  await Professor.insertMany(professors);

  // ---------------- Professor capacity ----------------
  const capRows = readCsv(DIR, 'professor_capacity_rules.csv');
  const capDocs = capRows.map((r) => ({
    professorId: r.professor_id,
    courseId: r.course_id,
    termId: 'TERM_2026_ODD',
    maxStudents: 60,
    seatsUsed: 0,
    maxSections: numOr(r.max_sections, 1),
    priority: 1,
  }));
  if (capDocs.length) await ProfessorCapacity.insertMany(capDocs);
  console.log(`[seed] courses=${courses.length} profs=${professors.length} capacity-rows=${capDocs.length}`);

  // ---------------- Terms + Batches ----------------
  const termRows = readCsv(DIR, 'terms.csv');
  if (termRows.length === 0) {
    await Term.create({ termId: 'TERM_2026_ODD', termName: 'Odd Semester 2026', status: 'planning' });
  } else {
    await Term.insertMany(termRows.map((t) => ({
      termId: t.term_id,
      termName: t.term_name,
      startDate: t.start_date, endDate: t.end_date,
      status: t.status || 'planning',
      registrationOpen: String(t.registration_open || 'yes').toLowerCase() === 'yes',
      schedulingLocked: String(t.scheduling_locked || 'no').toLowerCase() === 'yes',
    })));
  }
  const batchRows = readCsv(DIR, 'batches.csv');
  if (batchRows.length) {
    await Batch.insertMany(batchRows.map((b) => ({
      batchId: b.batch_id,
      batchName: b.batch_name,
      departmentId: b.department_id,
      semester: numOr(b.semester, 5),
      strength: numOr(b.strength, 0),
      programName: b.program_name,
      sectionName: b.section_name,
      academicYear: b.academic_year,
      branchName: b.branch_name,
      groupSet: b.group_set,
      active: b.active_status === 'active',
    })));
  }

  // ---------------- Students ----------------
  const studentRows = readCsv(DIR, 'students.csv');
  const students = studentRows.map((r) => ({
    studentId: r.student_id,
    name: r.student_name,
    department: r.department_id || 'CSE',
    batchId: r.batch_id,
    division: r.division_name,
    group: r.group_name,
    semester: numOr(r.semester, 5),
    program: r.program_name || 'BTech',
    branch: r.branch_name || '',
    email: r.email || `${String(r.student_id).toLowerCase()}@students.scheduler.local`,
    status: r.status || 'active',
  }));
  if (students.length) await Student.insertMany(students);
  console.log(`[seed] students=${students.length} batches=${batchRows.length}`);

  // ---------------- Course offerings ----------------
  const offeringRows = readCsv(DIR, 'course_offerings.csv');
  const offerings = offeringRows.map((r) => ({
    courseOfferingId: r.course_offering_id,
    termId: r.term_id,
    courseId: r.course_id,
    batchId: r.batch_id,
    expectedEnrollment: numOr(r.expected_enrollment, 60),
    isElective: String(r.is_elective || '').toLowerCase() === 'yes',
    minSections: numOr(r.min_sections, 1),
    maxSections: numOr(r.max_sections, 1),
    specialRoomRequirement: r.special_room_requirement || 'Lecture',
    status: r.status || 'open',
  }));
  if (offerings.length) await CourseOffering.insertMany(offerings);
  console.log(`[seed] course-offerings=${offerings.length}`);

  // ---------------- Users (students + professors + admin) ----------------
  const userDocs = [];
  const credRows = readCsv(DIR, 'student_credentials.csv');
  for (const c of credRows) {
    userDocs.push({
      username: String(c.username).toLowerCase(),
      passwordHash: await User.hashPassword(c.password),
      role: 'student',
      displayName: c.student_name,
      studentId: c.student_id,
      email: `${c.username}@students.scheduler.local`,
    });
  }
  for (const p of professors) {
    userDocs.push({
      username: String(p.professorId).toLowerCase(),
      passwordHash: await User.hashPassword(`welcome@${p.professorId}`),
      role: 'professor',
      displayName: p.name,
      professorId: p.professorId,
      email: p.email,
    });
  }
  userDocs.push({
    username: 'admin',
    passwordHash: await User.hashPassword('admin@123'),
    role: 'admin',
    displayName: 'Scheduler Admin',
  });
  await User.insertMany(userDocs);
  console.log(`[seed] users=${userDocs.length}`);

  // ---------------- Student course selections → Registrations ----------------
  // Each row has { student_id, course_offering_id, course_id, professor_id,
  // slot_code } — the rebuild script writes these jointly so sections are
  // coherent and the scheduler sees clean (course, slot, prof) groups.
  const selRows = readCsv(DIR, 'student_course_selections.csv');
  if (selRows.length) {
    // Seat counters
    const seatCount = {}; // `${profId}|${courseId}` -> used
    for (const cap of capDocs) seatCount[`${cap.professorId}|${cap.courseId}`] = 0;

    const regs = [];
    for (const r of selRows) {
      if (!r.slot_code) continue;
      regs.push({
        studentId: r.student_id,
        courseId: r.course_id,
        courseOfferingId: r.course_offering_id,
        slotCode: r.slot_code,
        professorId: r.professor_id || null,
        termId: r.term_id,
        status: 'confirmed',
      });
      if (r.professor_id) seatCount[`${r.professor_id}|${r.course_id}`] = (seatCount[`${r.professor_id}|${r.course_id}`] || 0) + 1;
    }
    if (regs.length) {
      await Registration.insertMany(regs, { ordered: false }).catch((err) => {
        if (err.code !== 11000) throw err;
      });
    }
    const ops = [];
    for (const [key, used] of Object.entries(seatCount)) {
      const [professorId, courseId] = key.split('|');
      ops.push(ProfessorCapacity.updateOne({ professorId, courseId, termId: 'TERM_2026_ODD' }, { $set: { seatsUsed: used } }));
    }
    await Promise.all(ops);
    console.log(`[seed] registrations=${regs.length} seats-updated=${ops.length}`);
  }

  console.log('[seed] done.');
  await disconnectDB();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
