import { SLOT_BY_CODE } from './slots.js';
import { dayTravelCost } from './distance.js';

/**
 * Cost function for a candidate timetable. Lower is better.
 *
 * Components:
 *   travel              student travel metres per week
 *   tight               transfers that don't fit the 10-min gap (hard-ish)
 *   longStretch         minutes of 3+ hour contiguous runs
 *   profPref            professor preferred-slot misses
 *   dailyImbalance      variance of daily minutes per student
 *   roomWaste           unused seats across all assignments (near-fit objective)
 */
export const WEIGHTS = {
  travel: 1.0,
  tightTransfer: 500,
  longStretch: 50,
  profPreferenceMiss: 30,
  dailyImbalance: 10,
  roomWaste: 2,
};

export function scoreTimetable({ assignments, students, registrations, rooms, buildings, professors }) {
  const roomsById = Object.fromEntries(rooms.map((r) => [r.roomId, r]));
  const buildingsById = Object.fromEntries(buildings.map((b) => [b.buildingId, b]));
  const profsById = Object.fromEntries(professors.map((p) => [p.professorId, p]));

  const regsByStudent = {};
  for (const r of registrations) (regsByStudent[r.studentId] ||= []).push(r);
  const asgByCourse = {};
  for (const a of assignments) (asgByCourse[a.courseId] ||= []).push(a);

  let travel = 0;
  let tight = 0;
  let longStretch = 0;
  let dailyImbalance = 0;

  for (const student of students) {
    const regs = regsByStudent[student.studentId] || [];
    const studentMeetings = { MON: [], TUE: [], WED: [], THU: [], FRI: [] };
    for (const reg of regs) {
      const sections = asgByCourse[reg.courseId] || [];
      const section = sections.find((s) => s.slotCode === reg.slotCode) || sections[0];
      if (!section) continue;
      const slot = SLOT_BY_CODE[section.slotCode];
      if (!slot) continue;
      const room = roomsById[section.roomId];
      if (!room) continue;
      for (const m of slot.meetings) {
        studentMeetings[m.day].push({
          day: m.day, startMinute: m.startMinute, endMinute: m.endMinute, buildingId: room.buildingId,
        });
      }
    }
    const dailyLoads = [];
    for (const day of Object.keys(studentMeetings)) {
      const meetings = studentMeetings[day];
      if (!meetings.length) { dailyLoads.push(0); continue; }
      const { totalDist, tightTransfers } = dayTravelCost(meetings, buildingsById);
      travel += totalDist;
      tight += tightTransfers;
      const sorted = [...meetings].sort((a, b) => a.startMinute - b.startMinute);
      let runStart = sorted[0].startMinute;
      let runEnd = sorted[0].endMinute;
      let maxRun = runEnd - runStart;
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].startMinute - runEnd <= 15) {
          runEnd = Math.max(runEnd, sorted[i].endMinute);
        } else {
          runStart = sorted[i].startMinute;
          runEnd = sorted[i].endMinute;
        }
        maxRun = Math.max(maxRun, runEnd - runStart);
      }
      if (maxRun > 180) longStretch += (maxRun - 180);
      dailyLoads.push(meetings.reduce((acc, m) => acc + (m.endMinute - m.startMinute), 0));
    }
    const mean = dailyLoads.reduce((a, b) => a + b, 0) / Math.max(1, dailyLoads.length);
    const variance = dailyLoads.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, dailyLoads.length);
    dailyImbalance += Math.sqrt(variance);
  }

  let profPref = 0;
  let roomWaste = 0;
  for (const a of assignments) {
    const prof = profsById[a.professorId];
    if (prof && prof.preferredSlots && prof.preferredSlots.length > 0 && !prof.preferredSlots.includes(a.slotCode)) {
      profPref++;
    }
    const enrolled = a.enrolled || 0;
    const capacity = a.capacity || 0;
    if (capacity > 0 && enrolled > 0) {
      roomWaste += Math.max(0, capacity - enrolled);
    }
  }

  const components = { travel, tight, longStretch, profPref, dailyImbalance, roomWaste };
  const total =
    WEIGHTS.travel * travel +
    WEIGHTS.tightTransfer * tight +
    WEIGHTS.longStretch * longStretch +
    WEIGHTS.profPreferenceMiss * profPref +
    WEIGHTS.dailyImbalance * dailyImbalance +
    WEIGHTS.roomWaste * roomWaste;
  return { total, components };
}
