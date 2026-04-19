import User from '../../models/User.js';
import Student from '../../models/Student.js';
import Professor from '../../models/Professor.js';
import Course from '../../models/Course.js';
import Room from '../../models/Room.js';
import Building from '../../models/Building.js';
import Slot from '../../models/Slot.js';
import Registration from '../../models/Registration.js';
import TimetableEntry from '../../models/TimetableEntry.js';
import CourseOffering from '../../models/CourseOffering.js';
import ProfessorCapacity from '../../models/ProfessorCapacity.js';
import Term from '../../models/Term.js';
import Batch from '../../models/Batch.js';
import { readCsv, dataDir } from '../../seed/csvLoader.js';
import { getSlotCatalog, resetSlotCache } from '../../scheduler/slots.js';
import { resetDistanceMatrix } from '../../scheduler/distance.js';

/**
 * Loads the project CSVs into the currently-connected database. This is
 * essentially a compact version of seed.js tailored for the test harness —
 * small and idempotent (wipes first).
 */
export async function seedFixture() {
  resetSlotCache();
  resetDistanceMatrix();
  await Promise.all([
    User.deleteMany({}), Student.deleteMany({}), Professor.deleteMany({}),
    Course.deleteMany({}), Room.deleteMany({}), Building.deleteMany({}),
    Slot.deleteMany({}), Registration.deleteMany({}), TimetableEntry.deleteMany({}),
    CourseOffering.deleteMany({}), ProfessorCapacity.deleteMany({}),
    Term.deleteMany({}), Batch.deleteMany({}),
  ]);
  const DIR = dataDir();

  await Building.insertMany(readCsv(DIR, 'buildings.csv').map((r) => ({
    buildingId: r.building_id, name: r.building_name, campusName: r.campus_name || 'Main',
  })));
  await Room.insertMany(readCsv(DIR, 'rooms.csv').map((r) => ({
    roomId: r.room_id, name: r.room_name || r.room_id, buildingId: r.building_id,
    floor: Number(r.floor_number || 0), capacity: Number(r.capacity || 60),
    type: r.room_type === 'lab' ? 'lab' : 'theory', roomType: r.room_type || 'lecture',
  })));
  await Slot.insertMany(getSlotCatalog());

  await Course.insertMany(readCsv(DIR, 'courses.csv').map((r) => ({
    courseId: r.course_id, code: r.course_code || r.course_id, title: r.course_title,
    department: r.department_id || 'CSE', credits: Number(r.credits || 3),
    weeklyHours: Number(r.weekly_hours || 3),
    type: r.course_type === 'lab' ? 'lab' : 'theory',
    slotFamily: r.slot_family || 'THEORY_3',
    courseTypeCategory: r.course_type_category || 'Core',
    expectedEnrollment: Number(r.expected_enrollment || 60),
    requiresLabRoom: String(r.needs_lab || '').toLowerCase() === 'yes',
    isElective: String(r.course_type_category || '').toLowerCase().startsWith('open'),
  })));

  const elig = readCsv(DIR, 'professor_course_eligibility.csv');
  const eligByProf = {};
  for (const e of elig) (eligByProf[e.professor_id] ||= []).push(e.course_id);
  const profRows = readCsv(DIR, 'professors.csv');
  await Professor.insertMany(profRows.map((r) => ({
    professorId: r.professor_id, name: r.professor_name, department: r.department_id || 'CSE',
    eligibleCourses: eligByProf[r.professor_id] || [],
    teachingCourses: eligByProf[r.professor_id] || [],
    email: `${String(r.professor_id).toLowerCase()}@faculty.test.local`,
  })));

  await ProfessorCapacity.insertMany(readCsv(DIR, 'professor_capacity_rules.csv').map((r) => ({
    professorId: r.professor_id, courseId: r.course_id, termId: 'TERM_2026_ODD',
    maxStudents: Number(r.max_students_per_section || 40),
    maxSections: Number(r.max_sections || 1),
    seatsUsed: 0,
  })));

  await Term.create({ termId: 'TERM_2026_ODD', termName: 'Odd 2026', status: 'planning' });
  await Batch.insertMany(readCsv(DIR, 'batches.csv').map((b) => ({
    batchId: b.batch_id, batchName: b.batch_name, departmentId: b.department_id,
    semester: Number(b.semester || 5), strength: Number(b.strength || 60),
  })));

  await Student.insertMany(readCsv(DIR, 'students.csv').slice(0, 60).map((r) => ({
    studentId: r.student_id, name: r.student_name, department: r.department_id,
    batchId: r.batch_id, semester: Number(r.semester || 5), program: r.program_name || 'BTech',
    email: r.email || `${String(r.student_id).toLowerCase()}@test.local`, status: 'active',
  })));

  await CourseOffering.insertMany(readCsv(DIR, 'course_offerings.csv').map((r) => ({
    courseOfferingId: r.course_offering_id, termId: r.term_id, courseId: r.course_id, batchId: r.batch_id,
    expectedEnrollment: Number(r.expected_enrollment || 60),
    isElective: String(r.is_elective || '').toLowerCase() === 'yes',
    specialRoomRequirement: r.special_room_requirement || 'Lecture',
    status: r.status || 'open',
  })));
}
