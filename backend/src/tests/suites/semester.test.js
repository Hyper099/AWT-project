import Course from '../../models/Course.js';
import CourseOffering from '../../models/CourseOffering.js';
import Registration from '../../models/Registration.js';
import Room from '../../models/Room.js';
import Building from '../../models/Building.js';
import Professor from '../../models/Professor.js';
import Semester from '../../models/Semester.js';
import Slot from '../../models/Slot.js';
import Student from '../../models/Student.js';
import { allotSlots } from '../../services/allotSlots.js';
import { programmeProgress } from '../../services/programme.js';
import { runScheduler, findSelectionConflicts } from '../../scheduler/algorithm.js';
import { seedFixture } from '../harness/seedFixture.js';
import { studentsInTerm } from '../../services/enrolment.js';

function assert(cond, msg) { if (!cond) throw new Error(msg); }
const SEM7_BATCH = 'CSE_2023_SEM7_DIV1';
const SEM5_TERM = 'TERM_2025_ODD';
const SEM7_TERM = 'TERM_2026_ODD';

async function loadsBothSemesters() {
  await seedFixture();
  const sems = await Semester.find().sort({ semester: 1 }).lean();
  assert(sems.map((s) => s.semester).join() === '5,7', `expected semesters 5,7, got ${sems.map((s) => s.semester)}`);
  const [s5, s7] = sems;
  assert(s5.periods.some((p) => p.kind === 'lunch'), 'semester 5 should have a lunch period');
  assert(s7.periods.length === 9, `semester 7 should have 9 periods, got ${s7.periods.length}`);
  assert(s7.periods[2].startMinute === 11 * 60 + 10, 'semester 7 third period should start at 11:10');
  const slots7 = await Slot.countDocuments({ semester: 7 });
  assert(slots7 === 13, `expected 13 semester-7 slots from the sheet, got ${slots7}`);
  assert(s5.termId === SEM5_TERM && s7.termId === SEM7_TERM, 'semester 5 is last year\'s term, semester 7 this year\'s');
}

async function sameStudentsInBothSemesters() {
  const st = await Student.findOne({ studentId: '23BCP001' }).lean();
  assert(st.semester === 7 && st.batchId === SEM7_BATCH, `23BCP001 is now in semester 7, got ${st.semester} ${st.batchId}`);
  assert(st.enrolments.map((e) => e.semester).join() === '5,7', 'enrolled in semester 5 and 7');
  assert(!(await Student.exists({ studentId: /^22BCP6/ })), 'no 22BCP6xx sample students');
  const s7 = await studentsInTerm(SEM7_TERM, { semester: 7 });
  const s5 = await studentsInTerm(SEM5_TERM, { semester: 5 });
  assert(s7.length === s5.length && s7.length > 0, `same cohort in both terms: ${s5.length} vs ${s7.length}`);
}

async function sheetDataImported() {
  const ml = await Course.findOne({ code: '20CP401T' }).lean();
  assert(ml && ml.semester === 7 && ml.title === 'Machine Learning', 'Machine Learning should be a semester 7 course');
  const offs = await CourseOffering.find({ batchId: SEM7_BATCH }).lean();
  assert(offs.length === 17, `expected 17 semester-7 offerings, got ${offs.length}`);
  assert(await CourseOffering.countDocuments({ batchId: /SEM7/ }) === 17 * 7, 'all 7 divisions are offered semester 7');
  const groups = [...new Set(offs.map((o) => o.electiveGroup).filter(Boolean))].sort();
  assert(groups.join() === 'Elective I,Elective II,Elective III', `unexpected baskets ${groups}`);
  assert(offs.every((o) => o.allowedSlots.length > 0), 'every semester-7 offering runs at fixed times');
  const mlLabCourse = await Course.findOne({ code: '20CP401P' }).lean();
  const mlLab = offs.find((o) => o.courseId === mlLabCourse?.courseId);
  assert(mlLab?.allowedSlots.length === 2, 'the ML lab has one slot per group (G9, G10)');
  const sbk = await Professor.findOne({ professorId: 'P27' }).lean();
  assert(sbk?.name === 'Santosh Kumar Bharti', 'instructors from the sheet are added');
}

async function programmeRules() {
  const offs = [
    { courseId: 'A' }, { courseId: 'B' },
    { courseId: 'X', electiveGroup: 'G', electiveOption: 'X' }, { courseId: 'XL', electiveGroup: 'G', electiveOption: 'X' },
    { courseId: 'Y', electiveGroup: 'G', electiveOption: 'Y' }, { courseId: 'YL', electiveGroup: 'G', electiveOption: 'Y' },
  ];
  const none = programmeProgress(offs, []);
  assert(!none.complete && none.requiredCount === 4 && none.selectedCount === 0, 'empty selection needs 2 core + one 2-course option');
  const half = programmeProgress(offs, [{ courseId: 'A' }, { courseId: 'B' }, { courseId: 'X' }]);
  assert(!half.complete && half.selectedCount === 3, 'theory without its lab is incomplete');
  const full = programmeProgress(offs, ['A', 'B', 'Y', 'YL'].map((courseId) => ({ courseId })));
  assert(full.complete && full.groups[0].chosen === 'Y', 'core plus one whole option completes the programme');
  const both = programmeProgress(offs, ['A', 'B', 'X', 'Y'].map((courseId) => ({ courseId })));
  assert(both.conflicts.length === 1, 'two options from one basket is a conflict');
}

async function allocatorPicksOneOptionPerBasket() {
  await Registration.deleteMany({});
  const r = await allotSlots({ termId: SEM7_TERM, semester: 7 });
  assert(r.failures.length === 0, `semester 7 allocation failed: ${JSON.stringify(r.failures.slice(0, 3))}`);
  const [students, offs, regs] = await Promise.all([
    studentsInTerm(SEM7_TERM, { semester: 7 }),
    CourseOffering.find({ batchId: SEM7_BATCH }).lean(),
    Registration.find().lean(),
  ]);
  const regsBy = {};
  for (const reg of regs) (regsBy[reg.studentId] ||= []).push(reg);
  for (const s of students) {
    const p = programmeProgress(offs, regsBy[s.studentId] || []);
    assert(p.complete && p.conflicts.length === 0, `${s.studentId} does not hold a complete programme`);
    assert(regsBy[s.studentId].length === 9, `${s.studentId} should hold 9 courses, has ${regsBy[s.studentId].length}`);
  }
  // Options are spread rather than everyone landing in the first one.
  const perOption = {};
  for (const reg of regs) {
    const o = offs.find((x) => x.courseId === reg.courseId);
    if (o?.electiveGroup && o.electiveOption === o.courseId) perOption[o.courseId] = (perOption[o.courseId] || 0) + 1;
  }
  assert(Object.keys(perOption).length === 8, `expected all 8 elective options used, got ${Object.keys(perOption).length}`);
}

async function slotsStayOnTheirSemesterGrid() {
  await allotSlots({ termId: SEM5_TERM, semester: 5 });
  const [regs, slots, courses, offs] = await Promise.all([
    Registration.find().lean(), Slot.find().lean(), Course.find().lean(), CourseOffering.find().lean(),
  ]);
  const slotBy = Object.fromEntries(slots.map((s) => [s.slotCode, s]));
  const courseBy = Object.fromEntries(courses.map((c) => [c.courseId, c]));
  const allowed = {};
  for (const o of offs) if (o.allowedSlots.length) allowed[o.courseId] = new Set(o.allowedSlots);
  for (const reg of regs) {
    assert(slotBy[reg.slotCode].semester === courseBy[reg.courseId].semester,
      `${reg.courseId} (sem ${courseBy[reg.courseId].semester}) placed in ${reg.slotCode} (sem ${slotBy[reg.slotCode].semester})`);
    if (allowed[reg.courseId]) assert(allowed[reg.courseId].has(reg.slotCode), `${reg.courseId} placed outside its fixed slots`);
  }
}

async function eachTermSchedulesCleanly() {
  const [courses, rooms, buildings, professors] = await Promise.all([
    Course.find().lean(), Room.find().lean(), Building.find().lean(), Professor.find().lean(),
  ]);
  for (const [termId, sem] of [[SEM5_TERM, 5], [SEM7_TERM, 7]]) {
    const regs = await Registration.find({ termId }).lean();
    const { studentClashes, instructorClashes } = findSelectionConflicts(regs);
    assert(studentClashes.length === 0 && instructorClashes.length === 0, `${termId}: ${studentClashes.length} student / ${instructorClashes.length} instructor clashes`);
    const students = await studentsInTerm(termId);
    const { unplaced, assignments } = runScheduler({ courses, rooms, buildings, professors, students, registrations: regs, termId });
    assert(unplaced.length === 0, `${termId}: ${unplaced.length} sections unplaced: ${unplaced[0]?.reason}`);
    assert(assignments.length > 0 && assignments.every((a) => a.semester === sem), `${termId} schedules only semester ${sem}`);
  }
}

export default {
  name: 'semesters',
  cases: [
    ['semester 5 and 7 load with their own bell schedules', loadsBothSemesters],
    ['23BCP students are in semester 5 and 7', sameStudentsInBothSemesters],
    ['semester 7 courses, baskets and staff come from the sheet', sheetDataImported],
    ['programme rules: core + one whole option per basket', programmeRules],
    ['allocator gives each semester 7 student one option per basket', allocatorPicksOneOptionPerBasket],
    ['slots stay on their semester grid and fixed times', slotsStayOnTheirSemesterGrid],
    ['each term schedules with no clashes and every section placed', eachTermSchedulesCleanly],
  ],
};
