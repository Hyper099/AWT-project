/**
 * Grid columns come from the semester's bell schedule. Semester 5 runs on the
 * hour with a fixed lunch; Semester 7 uses the published sheet's periods
 * (11:10–12:05 …) with lunch depending on the elective.
 */

export const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI'];

/** Used until a semester's periods arrive: 09:00–18:00 on the hour, lunch at 13:00. */
export const HOURLY_PERIODS = [9, 10, 11, 12, 13, 14, 15, 16, 17].map((h, i) => ({
  periodNo: i + 1, startMinute: h * 60, endMinute: (h + 1) * 60, kind: h === 13 ? 'lunch' : 'class',
}));

export function fmtMinutes(min) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

export function periodLabel(p) {
  return fmtMinutes(p.startMinute);
}

/** Indexes of the periods a meeting overlaps. */
export function periodsCovered(meeting, periods) {
  const out = [];
  periods.forEach((p, i) => {
    if (meeting.startMinute < p.endMinute && p.startMinute < meeting.endMinute) out.push(i);
  });
  return out;
}

export function slotCoversCell(slot, day, periodIdx, periods) {
  return (slot.meetings || []).some((m) => m.day === day && periodsCovered(m, periods).includes(periodIdx));
}

export function scheduleSpan(periods) {
  if (!periods.length) return '';
  return `${fmtMinutes(periods[0].startMinute)} – ${fmtMinutes(periods[periods.length - 1].endMinute)}`;
}
