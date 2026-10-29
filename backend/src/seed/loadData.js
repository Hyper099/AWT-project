import bcrypt from 'bcryptjs';
import Batch from '../models/Batch.js';
import Building from '../models/Building.js';
import Course from '../models/Course.js';
import CourseOffering from '../models/CourseOffering.js';
import Professor from '../models/Professor.js';
import ProfessorCapacity from '../models/ProfessorCapacity.js';
import Registration from '../models/Registration.js';
import Room from '../models/Room.js';
import Semester from '../models/Semester.js';
import Slot from '../models/Slot.js';
import Student from '../models/Student.js';
import Term from '../models/Term.js';
import TimetableEntry from '../models/TimetableEntry.js';
import User from '../models/User.js';
import { DEFAULT_TERM_ID } from '../constants/term.js';
import { resetDistanceMatrix } from '../scheduler/distance.js';
import { getSlotCatalog, resetSlotCache } from '../scheduler/slots.js';
import { dataDir, readCsv } from './csvLoader.js';

export const ALL_MODELS = [
  User, Student, Professor, Course, Room, Building, Slot, Registration, TimetableEntry,
  CourseOffering, ProfessorCapacity, Term, Batch, Semester,
];

function numOr(val, def) {
  const n = Number(val);
  return Number.isFinite(n) && String(val).trim() !== '' ? n : def;
}

function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
}

const yes = (v) => String(v || '').toLowerCase() === 'yes';

/**
 * Wipes the connected database and loads every CSV in data/csv. Used by
 * `npm run seed` and by the test harness, so both see the same data.
 *
 * Options
 *   students        optional filter (studentRow) => boolean
 *   selections      also load student_course_selections.csv as registrations
 *   users           create logins (students in scope, instructors, admin)
 *   bcryptRounds    password hashing cost (tests use a low value)
 *   log             progress logger
 */
export async function loadData({
  students: keepStudent = () => true,
  selections = true,
  users = true,
  bcryptRounds = 10,
  log = () => {},
} = {}) {
  resetSlotCache();
  resetDistanceMatrix();
  await Promise.all(ALL_MODELS.map((m) => m.deleteMany({})));

  const DIR = dataDir();
  log(`reading CSVs from ${DIR}`);

  const buildings = readCsv(DIR, 'buildings.csv', { required: true }).map((r) => ({
    buildingId: r.building_id,
    name: r.building_name,
    campusName: r.campus_name || 'Main Campus',
    x: 0, y: 0,
  }));
  await Building.insertMany(buildings);

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
      hasProjector: yes(r.has_projector),
      hasLabEquipment: yes(r.has_lab_equipment),
    };
  });
  await Room.insertMany(rooms);

  const slots = getSlotCatalog();
  await Slot.insertMany(slots);

  // Semesters and their bell schedules.
  const periodsBySem = {};
  for (const p of readCsv(DIR, 'semester_periods.csv')) {
    (periodsBySem[p.semester] ||= []).push({
      periodNo: numOr(p.period_no, 0),
      startMinute: toMinutes(p.start_time),
      endMinute: toMinutes(p.end_time),
      kind: p.kind === 'lunch' ? 'lunch' : 'class',
    });
  }
  const semesters = readCsv(DIR, 'semesters.csv').map((r) => ({
    semester: numOr(r.semester, 0),
    name: r.semester_name || `Semester ${r.semester}`,
    termId: r.term_id || DEFAULT_TERM_ID,
    creditsRequired: numOr(r.credits_required, 0),
    timetableSource: r.timetable_source,
    periods: (periodsBySem[r.semester] || []).sort((a, b) => a.periodNo - b.periodNo),
  }));
  if (semesters.length) await Semester.insertMany(semesters);
  log(`buildings=${buildings.length} rooms=${rooms.length} slots=${slots.length} semesters=${semesters.length}`);

  const courses = readCsv(DIR, 'courses.csv', { required: true }).map((r) => ({
    courseId: r.course_id,
    code: r.course_code || r.course_id,
    title: r.course_title,
    department: r.department_id || 'CSE',
    credits: numOr(r.credits, 3),
    weeklyHours: numOr(r.weekly_hours, 3),
    type: r.course_type === 'lab' ? 'lab' : 'theory',
    slotFamily: r.slot_family || 'THEORY_3',
    courseTypeCategory: r.course_type_category || 'Core',
    semester: numOr(r.semester, 5),
    expectedEnrollment: numOr(r.expected_enrollment, 60),
    isElective: /elective/i.test(r.course_type_category || ''),
    requiresLabRoom: yes(r.needs_lab),
    roomTypeRequired: r.room_type_required || 'Lecture',
  }));
  await Course.insertMany(courses);

  const eligByProf = {};
  for (const e of readCsv(DIR, 'professor_course_eligibility.csv')) {
    (eligByProf[e.professor_id] ||= []).push(e.course_id);
  }
  const availByProf = { preferred: {}, unavailable: {} };
  for (const a of readCsv(DIR, 'professor_availability.csv')) {
    const key = a.availability_type;
    if (key !== 'preferred' && key !== 'unavailable') continue;
    (availByProf[key][a.professor_id] ||= []).push(a.slot_code || a.time_slot_id);
  }
  const professors = readCsv(DIR, 'professors.csv', { required: true }).map((r) => ({
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

  // Seat limits apply in the term the course's semester runs in.
  const termOfSemester = Object.fromEntries(semesters.map((x) => [x.semester, x.termId]));
  const termOfCourse = Object.fromEntries(courses.map((c) => [c.courseId, termOfSemester[c.semester] || DEFAULT_TERM_ID]));
  const capDocs = readCsv(DIR, 'professor_capacity_rules.csv').map((r) => ({
    professorId: r.professor_id,
    courseId: r.course_id,
    termId: termOfCourse[r.course_id] || DEFAULT_TERM_ID,
    maxStudents: numOr(r.max_students_per_section, 40) * numOr(r.max_sections, 1),
    seatsUsed: 0,
    maxSections: numOr(r.max_sections, 1),
    priority: 1,
  }));
  if (capDocs.length) await ProfessorCapacity.insertMany(capDocs);
  log(`courses=${courses.length} profs=${professors.length} capacity-rows=${capDocs.length}`);

  const termRows = readCsv(DIR, 'terms.csv');
  await Term.insertMany(termRows.length ? termRows.map((t) => ({
    termId: t.term_id,
    termName: t.term_name,
    startDate: t.start_date, endDate: t.end_date,
    status: t.status || 'planning',
    registrationOpen: String(t.registration_open || 'yes').toLowerCase() === 'yes',
    schedulingLocked: yes(t.scheduling_locked),
  })) : [{ termId: DEFAULT_TERM_ID, termName: 'Odd Semester 2026', status: 'planning' }]);

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

  // students.csv holds each student's first batch; student_enrolments.csv adds later terms.
  const laterEnrolments = {};
  for (const e of readCsv(DIR, 'student_enrolments.csv')) {
    (laterEnrolments[e.student_id] ||= []).push({
      termId: e.term_id, semester: numOr(e.semester, 0), batchId: e.batch_id, division: e.division_name, group: e.group_name,
    });
  }
  const studentDocs = readCsv(DIR, 'students.csv').filter(keepStudent).map((r) => ({
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
    enrolments: [
      { termId: termOfSemester[numOr(r.semester, 5)] || DEFAULT_TERM_ID, semester: numOr(r.semester, 5), batchId: r.batch_id, division: r.division_name, group: r.group_name },
      ...(laterEnrolments[r.student_id] || []),
    ].sort((a, b) => a.semester - b.semester),
  })).map((s) => {
    const latest = s.enrolments[s.enrolments.length - 1];
    return { ...s, semester: latest.semester, batchId: latest.batchId, division: latest.division, group: latest.group };
  });
  if (studentDocs.length) await Student.insertMany(studentDocs);
  const inScope = new Set(studentDocs.map((s) => s.studentId));
  log(`students=${studentDocs.length} batches=${batchRows.length}`);

  const offerings = readCsv(DIR, 'course_offerings.csv').map((r) => ({
    courseOfferingId: r.course_offering_id,
    termId: r.term_id,
    courseId: r.course_id,
    batchId: r.batch_id,
    expectedEnrollment: numOr(r.expected_enrollment, 60),
    isElective: yes(r.is_elective),
    minSections: numOr(r.min_sections, 1),
    maxSections: numOr(r.max_sections, 1),
    specialRoomRequirement: r.special_room_requirement || 'Lecture',
    status: r.status || 'open',
    electiveGroup: r.elective_group || null,
    electiveOption: r.elective_option || null,
    allowedSlots: (r.allowed_slots || '').split('|').filter(Boolean),
  }));
  if (offerings.length) await CourseOffering.insertMany(offerings);
  log(`course-offerings=${offerings.length}`);

  if (users) {
    const hash = (plain) => bcrypt.hash(plain, bcryptRounds);
    const creds = readCsv(DIR, 'student_credentials.csv').filter((c) => inScope.has(c.student_id));
    const userDocs = await Promise.all([
      ...creds.map(async (c) => ({
        username: String(c.username).toLowerCase(),
        passwordHash: await hash(c.password),
        role: 'student',
        displayName: c.student_name,
        studentId: c.student_id,
        email: `${c.username}@students.scheduler.local`,
      })),
      ...professors.map(async (p) => ({
        username: String(p.professorId).toLowerCase(),
        passwordHash: await hash(`welcome@${p.professorId}`),
        role: 'professor',
        displayName: p.name,
        professorId: p.professorId,
        email: p.email,
      })),
      (async () => ({
        username: 'admin',
        passwordHash: await hash('admin@123'),
        role: 'admin',
        displayName: 'Scheduler Admin',
      }))(),
    ]);
    await User.insertMany(userDocs);
    log(`users=${userDocs.length}`);
  }

  if (selections) {
    // Rows carry (student, offering, course, instructor, slot) together, so
    // sections are coherent and the scheduler sees clean groups.
    const seatCount = {};
    const regs = [];
    for (const r of readCsv(DIR, 'student_course_selections.csv')) {
      if (!r.slot_code || !inScope.has(r.student_id)) continue;
      regs.push({
        studentId: r.student_id,
        courseId: r.course_id,
        courseOfferingId: r.course_offering_id,
        slotCode: r.slot_code,
        professorId: r.professor_id || null,
        termId: r.term_id,
        status: 'confirmed',
      });
      if (r.professor_id) {
        const key = `${r.professor_id}|${r.course_id}|${r.term_id}`;
        seatCount[key] = (seatCount[key] || 0) + 1;
      }
    }
    if (regs.length) {
      await Registration.insertMany(regs, { ordered: false }).catch((err) => {
        if (err.code !== 11000) throw err;
      });
    }
    await Promise.all(Object.entries(seatCount).map(([key, used]) => {
      const [professorId, courseId, termId] = key.split('|');
      return ProfessorCapacity.updateOne({ professorId, courseId, termId }, { $set: { seatsUsed: used } });
    }));
    log(`registrations=${regs.length} seats-updated=${Object.keys(seatCount).length}`);
  }
}
