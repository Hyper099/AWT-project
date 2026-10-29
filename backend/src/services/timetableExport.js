import PDFDocument from 'pdfkit';
import Student from '../models/Student.js';
import Registration from '../models/Registration.js';
import Course from '../models/Course.js';
import Slot from '../models/Slot.js';
import TimetableEntry from '../models/TimetableEntry.js';
import Room from '../models/Room.js';
import Building from '../models/Building.js';
import Professor from '../models/Professor.js';

const DAY_ORDER = { MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6, SUN: 7 };

function formatMinutes(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Returns structured timetable rows for a student, each representing one meeting
 * of a scheduled class: day, start, end, course, slot, room, building, instructor.
 */
export async function buildTimetableRows(studentId, termId = 'TERM_2026_ODD') {
  const regs = await Registration.find({ studentId, termId }).lean();
  const courseIds = regs.map((r) => r.courseId);

  const [student, courses, slots, entries, rooms, buildings, professors] = await Promise.all([
    Student.findOne({ studentId }).lean(),
    Course.find({ courseId: { $in: courseIds } }).lean(),
    Slot.find().lean(),
    TimetableEntry.find({ termId, courseId: { $in: courseIds } }).lean(),
    Room.find().lean(),
    Building.find().lean(),
    Professor.find().lean(),
  ]);

  const slotByCode = Object.fromEntries(slots.map((s) => [s.slotCode, s]));
  const courseById = Object.fromEntries(courses.map((c) => [c.courseId, c]));
  const roomById = Object.fromEntries(rooms.map((r) => [r.roomId, r]));
  const bldById = Object.fromEntries(buildings.map((b) => [b.buildingId, b]));
  const profById = Object.fromEntries(professors.map((p) => [p.professorId, p]));

  const rows = [];
  let scheduledCount = 0;
  for (const reg of regs) {
    const slot = slotByCode[reg.slotCode];
    // Only the student's own section counts; another section of the same
    // course has a different room and instructor.
    const entry = entries.find((e) => e.courseId === reg.courseId
      && e.slotCode === reg.slotCode && e.professorId === reg.professorId);
    const course = courseById[reg.courseId];
    const room = entry ? roomById[entry.roomId] : null;
    const bld = room ? bldById[room.buildingId] : null;
    const prof = entry ? profById[entry.professorId] : null;
    if (entry) scheduledCount += 1;
    if (!slot || !course) continue;
    for (const m of slot.meetings) {
      rows.push({
        day: m.day,
        startMinute: m.startMinute,
        endMinute: m.endMinute,
        startTime: formatMinutes(m.startMinute),
        endTime: formatMinutes(m.endMinute),
        courseId: course.courseId,
        courseCode: course.code,
        courseTitle: course.title,
        slotCode: reg.slotCode,
        roomName: room?.name,
        roomId: room?.roomId,
        buildingName: bld?.name,
        buildingId: bld?.buildingId,
        professorName: prof?.name,
        professorId: prof?.professorId,
        allotted: Boolean(entry),
      });
    }
  }

  rows.sort((a, b) => (DAY_ORDER[a.day] - DAY_ORDER[b.day]) || (a.startMinute - b.startMinute));

  return {
    student,
    termId,
    totalRegistered: regs.length,
    totalScheduled: scheduledCount,
    rows,
  };
}

export async function timetableStatus(studentId, termId = 'TERM_2026_ODD') {
  const { totalRegistered, totalScheduled } = await buildTimetableRows(studentId, termId);
  return {
    termId,
    totalRegistered,
    totalScheduled,
    allotted: totalRegistered > 0 && totalScheduled === totalRegistered,
    partiallyAllotted: totalScheduled > 0 && totalScheduled < totalRegistered,
  };
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function renderCsv({ student, termId, rows }) {
  const header = [
    'Student Name', 'Student ID', 'Term',
    'Day', 'Start', 'End', 'Course Code', 'Course Title', 'Slot', 'Room', 'Building', 'Instructor',
  ];
  const lines = [header.map(csvEscape).join(',')];
  for (const r of rows) {
    lines.push([
      student?.name, student?.studentId, termId,
      r.day, r.startTime, r.endTime, r.courseCode, r.courseTitle,
      r.slotCode, r.roomName, r.buildingName, r.professorName,
    ].map(csvEscape).join(','));
  }
  return lines.join('\n') + '\n';
}

/**
 * Streams a PDF to the provided writable (typically Express response).
 * Layout: letterhead, student meta block, then a table of classes grouped by day.
 */
export function renderPdfToStream({ student, termId, rows }, stream) {
  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  doc.pipe(stream);

  doc.font('Helvetica-Bold').fontSize(20).text('Campus Timetable', { align: 'left' });
  doc.moveDown(0.2);
  doc.font('Helvetica').fontSize(11).fillColor('#525252')
    .text(`Term ${termId}`, { align: 'left' });
  doc.fillColor('#000000');
  doc.moveDown(1);

  // Student block
  doc.font('Helvetica-Bold').fontSize(12).text('Student');
  doc.font('Helvetica').fontSize(11);
  doc.text(`${student?.name || ''}`);
  doc.text(`ID: ${student?.studentId || ''}`);
  if (student?.program || student?.branch) {
    doc.text(`${[student.program, student.branch].filter(Boolean).join(' · ')}`);
  }
  if (student?.semester) doc.text(`Semester ${student.semester}`);
  doc.moveDown(1);

  // Table header
  const startY = doc.y;
  const cols = [
    { label: 'Day', width: 50 },
    { label: 'Time', width: 85 },
    { label: 'Course', width: 150 },
    { label: 'Slot', width: 40 },
    { label: 'Room', width: 70 },
    { label: 'Building', width: 110 },
  ];
  let x = doc.page.margins.left;
  doc.font('Helvetica-Bold').fontSize(10);
  for (const c of cols) {
    doc.text(c.label, x, startY, { width: c.width });
    x += c.width;
  }
  doc.moveTo(doc.page.margins.left, doc.y + 2).lineTo(doc.page.width - doc.page.margins.right, doc.y + 2).strokeColor('#d4d4d4').stroke();
  doc.strokeColor('#000000');
  doc.moveDown(0.8);

  doc.font('Helvetica').fontSize(10);
  for (const r of rows) {
    if (doc.y > doc.page.height - 80) doc.addPage();
    const y = doc.y;
    let cx = doc.page.margins.left;
    const cells = [
      r.day,
      `${r.startTime}–${r.endTime}`,
      `${r.courseCode} · ${r.courseTitle}`,
      r.slotCode,
      r.roomName || '—',
      r.buildingName || '—',
    ];
    for (let i = 0; i < cols.length; i++) {
      doc.text(cells[i] ?? '', cx, y, { width: cols[i].width });
      cx += cols[i].width;
    }
    const rowBottom = Math.max(...cols.map((c, i) => {
      const h = doc.heightOfString(cells[i] ?? '', { width: c.width });
      return y + h;
    }));
    doc.y = rowBottom + 4;
  }

  if (rows.length === 0) {
    doc.moveDown(0.5);
    doc.font('Helvetica-Oblique').fontSize(11).fillColor('#525252')
      .text('No classes scheduled for this term yet.');
    doc.fillColor('#000000');
  }

  doc.end();
}
