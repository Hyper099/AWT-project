import { createApp } from '../../app.js';
import Course from '../../models/Course.js';
import CourseOffering from '../../models/CourseOffering.js';
import Registration from '../../models/Registration.js';
import TimetableEntry from '../../models/TimetableEntry.js';
import { seedFixture } from '../harness/seedFixture.js';

/**
 * End-to-end checks over HTTP for all three roles, against the fixture
 * (the 60 Div-1 students, enrolled in Semester 5 last year and Semester 7 now).
 */

function assert(cond, msg) { if (!cond) throw new Error(msg); }

let server;
let base;
const tokens = {};

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}

function expectStatus(r, status, what) {
  assert(r.status === status, `${what}: expected ${status}, got ${r.status} ${JSON.stringify(r.data)?.slice(0, 200)}`);
  return r.data;
}

async function login(username, password) {
  const r = await call('POST', '/auth/login', { body: { username, password } });
  return expectStatus(r, 200, `login ${username}`).token;
}

const STUDENT = '23bcp001'; // Div-1, G1: Semester 5 (2025) and Semester 7 (2026)
const SEM5 = '?termId=TERM_2025_ODD';
const SHARED_INSTRUCTOR = 'p12'; // Sidheswar Routray: Semester 5 and Semester 7 (ML, IR)

async function setUp() {
  await seedFixture({ users: true });
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  tokens.sem7 = await login(STUDENT, `ts@${STUDENT}`);
  tokens.sem5 = tokens.sem7; // same student; Semester 5 calls pass TERM_2025_ODD
  tokens.prof = await login(SHARED_INSTRUCTOR, 'welcome@P12');
  tokens.admin = await login('admin', 'admin@123');
}

async function authAndRoleGuards() {
  expectStatus(await call('POST', '/auth/login', { body: { username: 'admin', password: 'wrong' } }), 401, 'bad password');
  expectStatus(await call('GET', '/student/me'), 401, 'no token');
  expectStatus(await call('GET', '/admin/status', { token: tokens.sem7 }), 403, 'student on admin route');
  expectStatus(await call('GET', '/admin/status', { token: tokens.prof }), 403, 'instructor on admin route');
  expectStatus(await call('POST', '/scheduler/generate-timetable', { token: tokens.sem5, body: {} }), 403, 'student publishing');
  expectStatus(await call('GET', '/professor/me', { token: tokens.sem7 }), 403, 'student on instructor route');
  expectStatus(await call('GET', '/student/me', { token: tokens.admin }), 403, 'admin on student route');
  const sems = expectStatus(await call('GET', '/semesters', { token: tokens.sem5 }), 200, 'list semesters');
  assert(sems.length === 2 && sems[1].batches.length === 7 && sems[0].termId === 'TERM_2025_ODD', 'semesters list both');
  const me = expectStatus(await call('GET', '/student/me', { token: tokens.sem7 }), 200, 'me');
  assert(me.semester === 7 && me.enrolments.length === 2, 'student is in semester 7 now and was in semester 5');
}

// ---------------------------------------------------------------- student
async function studentSeesOwnSemesterGrid() {
  const g7 = expectStatus(await call('GET', '/student/grid', { token: tokens.sem7 }), 200, 'sem 7 grid');
  assert(g7.semester.semester === 7 && g7.semester.periods.length === 9, 'semester 7 student gets the 9-period sheet grid');
  assert(g7.slots.length === 13 && g7.slots.every((s) => s.semester === 7), 'only semester 7 slots');
  const g5 = expectStatus(await call('GET', `/student/grid${SEM5}`, { token: tokens.sem5 }), 200, 'sem 5 grid');
  assert(g5.semester.semester === 5 && g5.slots.every((s) => s.semester === 5), 'semester 5 student gets the semester 5 grid');
  const offs = expectStatus(await call('GET', '/student/offerings', { token: tokens.sem7 }), 200, 'sem 7 offerings');
  assert(offs.length === 17 && offs.every((o) => o.course.semester === 7), 'semester 7 offerings only');
}

async function studentRegistersWithinTheRules() {
  await Registration.deleteMany({});
  const byCode = async (code) => (await Course.findOne({ code }).lean()).courseId;
  const [ml, mlLab, nlp, nlpLab, bc] = await Promise.all(['20CP401T', '20CP401P', '20CP405T', '20CP405P', '20CP406T'].map(byCode));
  const t = tokens.sem7;

  let r = await call('POST', '/student/register', { token: t, body: { courseId: ml, slotCode: '7T1', professorId: 'P12' } });
  assert(r.status === 409 && /does not run in slot/.test(r.data.error), `ML outside its fixed slot must be refused, got ${r.status}`);
  r = await call('POST', '/student/register', { token: t, body: { courseId: ml, slotCode: 'A1', professorId: 'P12' } });
  assert(r.status === 409, 'a semester 5 slot must be refused for a semester 7 course');

  expectStatus(await call('POST', '/student/register', { token: t, body: { courseId: ml, slotCode: '7T4', professorId: 'P12' } }), 201, 'register ML');
  expectStatus(await call('POST', '/student/register', { token: t, body: { courseId: mlLab, slotCode: '7L6', professorId: 'P12' } }), 201, 'register ML lab (Friday)');
  expectStatus(await call('POST', '/student/register', { token: t, body: { courseId: nlp, slotCode: '7T1', professorId: 'P27' } }), 201, 'register NLP');
  r = await call('POST', '/student/register', { token: t, body: { courseId: bc, slotCode: '7T1', professorId: 'P14' } });
  assert(r.status === 409, 'second option in the same basket must be refused');
  expectStatus(await call('POST', '/student/register', { token: t, body: { courseId: nlpLab, slotCode: '7L5', professorId: 'P27' } }), 201, 'register NLP lab');

  const p = expectStatus(await call('GET', '/student/programme', { token: t }), 200, 'programme');
  assert(p.semester === 7 && p.creditsRequired === 14, 'programme reports semester 7 and 14 credits');
  assert(p.selectedCount === 4 && !p.complete, `4 of 9 selected, got ${p.selectedCount}/${p.requiredCount}`);
  assert(p.groups.find((g) => g.group === 'Elective I').chosen === nlp, 'Elective I chosen as NLP');

  expectStatus(await call('DELETE', `/student/register/${nlpLab}`, { token: t }), 200, 'drop NLP lab');
  expectStatus(await call('DELETE', `/student/register/${nlp}`, { token: t }), 200, 'drop NLP');
  expectStatus(await call('POST', '/student/register', { token: t, body: { courseId: bc, slotCode: '7T1', professorId: 'P14' } }), 201, 'switch basket option after dropping');

  const profs = expectStatus(await call('GET', `/student/professors?courseId=${ml}&slotCode=7T4`, { token: t }), 200, 'instructor list');
  const sheetProf = profs.find((p) => p.professorId === 'P12');
  assert(sheetProf && sheetProf.seatsRemaining === 69, 'ML seat counter reflects one registration');
}

async function semester5StudentUnaffected() {
  const offs = expectStatus(await call('GET', `/student/offerings${SEM5}`, { token: tokens.sem5 }), 200, 'sem 5 offerings');
  assert(offs.length === 9 && offs.every((o) => o.course.semester === 5 && !o.offering.electiveGroup), 'semester 5 keeps its 9 assigned courses');
  const ai = offs.find((o) => o.course.code === '23CP307T');
  const profs = expectStatus(await call('GET', `/student/professors?courseId=${ai.course.courseId}&slotCode=A1&termId=TERM_2025_ODD`, { token: tokens.sem5 }), 200, 'AI instructors');
  const free = profs.find((p) => p.available && p.seatsRemaining > 0);
  assert(free, 'some AI instructor is free at A1');
  expectStatus(await call('POST', '/student/register', { token: tokens.sem5, body: { courseId: ai.course.courseId, slotCode: 'A1', professorId: free.professorId, termId: 'TERM_2025_ODD' } }), 201, 'register AI at A1');
  const r = await call('POST', '/student/register', { token: tokens.sem5, body: { courseId: ai.course.courseId, slotCode: '7T2', professorId: free.professorId, termId: 'TERM_2025_ODD' } });
  assert(r.status === 409, 'semester 7 slot refused for a semester 5 course');
}

// ---------------------------------------------------------------- admin
async function adminSeesSemesters() {
  const rows = expectStatus(await call('GET', '/admin/semesters', { token: tokens.admin }), 200, 'admin semesters');
  assert(rows.length === 2, 'two semesters');
  const s7 = rows.find((r) => r.semester === 7);
  const s5 = rows.find((r) => r.semester === 5);
  assert(s7.totals.students === 60 && s5.totals.students === 60 && s7.creditsRequired === 14, 'both semesters have the same 60 students');
  const st = expectStatus(await call('GET', '/admin/status?semester=7', { token: tokens.admin }), 200, 'status sem 7');
  assert(st.termId === 'TERM_2026_ODD' && Object.keys(st.byBatch).join() === 'CSE_2023_SEM7_DIV1', 'status filtered to semester 7');
  assert(st.professorCourseStatus.every((c) => c.courseId >= 'CS031'), 'seat table filtered to semester 7 courses');
}

async function adminPublishesSemesterBySemester() {
  const a = await call('POST', '/admin/allot-slots', { token: tokens.admin, body: { semester: 7 } });
  expectStatus(a, 200, 'make slots sem 7');
  assert(a.data.failures.length === 0, `make slots sem 7 failures: ${JSON.stringify(a.data.failures.slice(0, 2))}`);

  // Semester 5 (last year's term) is still incomplete, which does not block semester 7.
  const refused = await call('POST', '/scheduler/generate-timetable', { token: tokens.admin, body: { semester: 5 } });
  assert(refused.status === 409, 'semester 5 publish refused while it is incomplete');
  const p7 = expectStatus(await call('POST', '/scheduler/generate-timetable', { token: tokens.admin, body: { semester: 7 } }), 200, 'publish sem 7');
  assert(p7.complete && p7.semester === 7 && p7.studentsComplete === 60, `publish sem 7: ${JSON.stringify({ ...p7, unplaced: undefined })}`);
  const sem7Entries = await TimetableEntry.find({ semester: 7 }).lean();
  assert(sem7Entries.length === p7.assigned, 'semester 7 entries saved');

  expectStatus(await call('POST', '/admin/allot-slots', { token: tokens.admin, body: { semester: 5 } }), 200, 'make slots sem 5');
  const p5 = expectStatus(await call('POST', '/scheduler/generate-timetable', { token: tokens.admin, body: { semester: 5 } }), 200, 'publish sem 5');
  assert(p5.complete, `publish sem 5 incomplete: ${JSON.stringify(p5.unplaced?.slice(0, 2))}`);
  const after7 = await TimetableEntry.find({ semester: 7 }).lean();
  assert(after7.length === sem7Entries.length
    && after7.every((e) => sem7Entries.some((x) => x.sectionId === e.sectionId && x.roomId === e.roomId)),
  'publishing semester 5 leaves semester 7 untouched');

  for (const semester of [5, 7]) {
    const st = expectStatus(await call('GET', `/admin/status?semester=${semester}`, { token: tokens.admin }), 200, 'status');
    assert(st.totals.studentsAllotted === st.totals.students, `sem ${semester}: every student allotted: ${st.totals.studentsAllotted}/${st.totals.students}`);
  }
}

async function studentAndInstructorSeePublishedTimetable() {
  const status = expectStatus(await call('GET', '/student/timetable/status', { token: tokens.sem7 }), 200, 'timetable status');
  assert(status.allotted, 'semester 7 student timetable is allotted');
  const rows = expectStatus(await call('GET', '/student/timetable', { token: tokens.sem7 }), 200, 'student timetable');
  assert(rows.every((r) => r.roomName && r.professorName), 'every class has a room and instructor');
  const ml = rows.find((r) => r.courseCode === '20CP401T');
  assert(ml && ml.startTime === '11:10' && ['TUE', 'WED'].includes(ml.day), 'ML meets Tue/Wed 11:10 as on the sheet');
  const pdf = await fetch(`${base}/student/timetable/download?format=pdf`, { headers: { Authorization: `Bearer ${tokens.sem7}` } });
  assert(pdf.status === 200 && pdf.headers.get('content-type') === 'application/pdf', 'PDF download');

  const me = expectStatus(await call('GET', '/professor/me', { token: tokens.prof }), 200, 'instructor me');
  assert(me.professorId === 'P12', 'instructor profile');
  const sems = expectStatus(await call('GET', '/professor/semesters', { token: tokens.prof }), 200, 'instructor semesters');
  assert(sems.map((s) => s.semester).join() === '5,7', 'SIRO teaches in semesters 5 and 7');
  const tt = expectStatus(await call('GET', '/professor/timetable', { token: tokens.prof }), 200, 'instructor timetable');
  const s7 = tt.filter((r) => r.semester === 7);
  assert(s7.some((r) => r.courseCode === '20CP417T' || r.courseCode === '20CP401T'), 'instructor sees semester 7 classes');
  assert(tt.some((r) => r.semester === 5), 'instructor also sees last year\'s semester 5 classes');
  // No two of the instructor's meetings in the same semester overlap.
  for (let i = 0; i < tt.length; i++) {
    for (let j = i + 1; j < tt.length; j++) {
      const a = tt[i]; const b = tt[j];
      if (a.semester === b.semester && a.day === b.day && a.startMinute < b.endMinute && b.startMinute < a.endMinute && a.slotCode !== b.slotCode) {
        throw new Error(`instructor double-booked: ${a.courseCode} ${a.slotCode} / ${b.courseCode} ${b.slotCode}`);
      }
    }
  }
}

async function instructorSavesPreferences() {
  const r = expectStatus(await call('POST', '/professor/courses/select', {
    token: tokens.prof, body: { preferredSlots: ['7T4'], unavailableSlots: ['A1'] },
  }), 200, 'save preferences');
  assert(r.preferredSlots.join() === '7T4' && r.unavailableSlots.join() === 'A1', 'preferences saved');
  const courses = expectStatus(await call('GET', '/professor/courses', { token: tokens.prof }), 200, 'instructor courses');
  assert(courses.some((c) => c.semester === 7) && courses.some((c) => c.semester === 5), 'eligible courses span both semesters');
}

async function adminResetsOneSemester() {
  const r = expectStatus(await call('POST', '/admin/reset-allocation', { token: tokens.admin, body: { semester: 7 } }), 200, 'reset sem 7');
  assert(r.selectionsDeleted === 60 * 9, `expected 540 semester 7 selections removed, got ${r.selectionsDeleted}`);
  assert(await Registration.countDocuments({ termId: 'TERM_2026_ODD' }) === 0, 'semester 7 selections gone');
  assert(await Registration.countDocuments({ termId: 'TERM_2025_ODD' }) > 0, 'semester 5 selections kept');
  assert(await TimetableEntry.countDocuments({ semester: 7 }) === 0 && await TimetableEntry.countDocuments({ semester: 5 }) > 0,
    'only semester 7 timetable cleared');
  const offs = await CourseOffering.countDocuments({ batchId: 'CSE_2023_SEM7_DIV1' });
  assert(offs === 17, 'offerings are not touched by a reset');
}

async function tearDown() {
  await new Promise((r) => server.close(r));
}

export default {
  name: 'api (student, instructor, admin)',
  cases: [
    ['set up server and log in as each role', setUp],
    ['auth and role guards', authAndRoleGuards],
    ['student: grid and offerings follow their semester', studentSeesOwnSemesterGrid],
    ['student: fixed slots and one option per basket', studentRegistersWithinTheRules],
    ['student: semester 5 registration unaffected', semester5StudentUnaffected],
    ['admin: per-semester summary and filtered status', adminSeesSemesters],
    ['admin: make slots and publish semester by semester', adminPublishesSemesterBySemester],
    ['student + instructor: published timetables', studentAndInstructorSeePublishedTimetable],
    ['instructor: saves preferences, sees both semesters', instructorSavesPreferences],
    ['admin: reset one semester only', adminResetsOneSemester],
    ['shut down server', tearDown],
  ],
};
