// Slot catalog is loaded from data/csv/time_slots.csv at startup. We preserve
// the `SLOT_CATALOG`/`SLOT_BY_CODE`/`slotsClash`/`buildClashIndex` exports so
// existing callers (algorithm, registration validation) keep working.

import { readCsv, dataDir } from '../seed/csvLoader.js';

const DAY_VALUES = new Set(['MON', 'TUE', 'WED', 'THU', 'FRI']);

function timeToMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
}

/** Hard-coded fallback catalog — used only if time_slots.csv is absent. */
const FALLBACK = [
  { slotCode: 'A1', family: 'THEORY_3', type: 'theory', meetings: [['MON', 9], ['WED', 9], ['FRI', 9]] },
  { slotCode: 'B1', family: 'THEORY_3', type: 'theory', meetings: [['MON', 10], ['WED', 10], ['FRI', 10]] },
  { slotCode: 'C1', family: 'THEORY_3', type: 'theory', meetings: [['MON', 11], ['WED', 11], ['FRI', 11]] },
  { slotCode: 'D1', family: 'THEORY_2', type: 'theory', meetings: [['TUE', 9], ['THU', 9]] },
  { slotCode: 'E1', family: 'THEORY_2', type: 'theory', meetings: [['TUE', 10], ['THU', 10]] },
  { slotCode: 'F1', family: 'THEORY_2', type: 'theory', meetings: [['TUE', 11], ['THU', 11]] },
  { slotCode: 'L1', family: 'LAB_2', type: 'lab', meetings: [['MON', 14, 2], ['WED', 14, 2]] },
].map(({ slotCode, family, type, meetings }) => ({
  slotCode, family, type,
  meetings: meetings.map(([day, h, dur = 1]) => ({ day, startMinute: h * 60, endMinute: (h + dur) * 60 })),
}));

let CATALOG = null;
let BY_CODE = null;
let CLASH_IDX = null;

function loadCatalog() {
  const rows = readCsv(dataDir(), 'time_slots.csv');
  if (rows.length === 0) return FALLBACK;
  const bySlot = {};
  for (const r of rows) {
    const code = r.slot_code;
    if (!code) continue;
    if (!DAY_VALUES.has(r.day_of_week)) continue;
    const startMinute = timeToMinutes(r.start_time);
    const endMinute = timeToMinutes(r.end_time);
    if (!Number.isFinite(startMinute) || !Number.isFinite(endMinute)) continue;
    if (!bySlot[code]) {
      bySlot[code] = {
        slotCode: code,
        family: r.slot_family || 'THEORY_3',
        type: (r.slot_family || '').startsWith('LAB') ? 'lab' : 'theory',
        meetings: [],
      };
    }
    bySlot[code].meetings.push({ day: r.day_of_week, startMinute, endMinute });
  }
  const out = Object.values(bySlot).sort((a, b) => a.slotCode.localeCompare(b.slotCode));
  return out;
}

export function resetSlotCache() { CATALOG = null; BY_CODE = null; CLASH_IDX = null; }

export function getSlotCatalog() {
  if (!CATALOG) CATALOG = loadCatalog();
  return CATALOG;
}

export function getSlotByCode() {
  if (!BY_CODE) BY_CODE = Object.fromEntries(getSlotCatalog().map((s) => [s.slotCode, s]));
  return BY_CODE;
}

/** Back-compat named exports (these shadow the mutable cache). */
export const SLOT_CATALOG = new Proxy([], {
  get(_t, prop) { return getSlotCatalog()[prop]; },
  has(_t, prop) { return prop in getSlotCatalog(); },
  ownKeys() { return Reflect.ownKeys(getSlotCatalog()); },
  getOwnPropertyDescriptor(_t, prop) { return Object.getOwnPropertyDescriptor(getSlotCatalog(), prop); },
});
export const SLOT_BY_CODE = new Proxy({}, {
  get(_t, prop) { return getSlotByCode()[prop]; },
  has(_t, prop) { return prop in getSlotByCode(); },
  ownKeys() { return Reflect.ownKeys(getSlotByCode()); },
  getOwnPropertyDescriptor(_t, prop) { return Object.getOwnPropertyDescriptor(getSlotByCode(), prop); },
});

/** Two slots clash if any meeting overlaps on the same day. */
export function slotsClash(a, b) {
  if (!a || !b) return false;
  for (const m1 of a.meetings) {
    for (const m2 of b.meetings) {
      if (m1.day !== m2.day) continue;
      if (m1.startMinute < m2.endMinute && m2.startMinute < m1.endMinute) return true;
    }
  }
  return false;
}

export function buildClashIndex() {
  if (CLASH_IDX) return CLASH_IDX;
  const catalog = getSlotCatalog();
  const idx = {};
  for (const a of catalog) {
    idx[a.slotCode] = new Set();
    for (const b of catalog) {
      if (a.slotCode !== b.slotCode && slotsClash(a, b)) idx[a.slotCode].add(b.slotCode);
    }
  }
  CLASH_IDX = idx;
  return CLASH_IDX;
}
