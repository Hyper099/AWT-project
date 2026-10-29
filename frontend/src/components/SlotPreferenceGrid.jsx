import { DAYS, HOURLY_PERIODS, periodLabel, periodsCovered } from '../lib/periods.js';

/**
 * Weekly grid where each cell contains one small chip per slot that meets in
 * that (day, period). Clicking a chip toggles its slotCode in `selected`.
 *
 * Props:
 *   slots       — the slots of one semester (from /api/courses/slots?semester=N)
 *   periods     — that semester's bell schedule
 *   selected    — array of slotCodes currently in the active list
 *   locked      — array of slotCodes that cannot be toggled (already in the other list)
 *   onToggle    — (slotCode) => void
 *   variant     — 'preferred' | 'unavailable' — changes selected-chip style
 */
export default function SlotPreferenceGrid({ slots, periods = HOURLY_PERIODS, selected = [], locked = [], onToggle, variant = 'preferred' }) {
  // Build (day|period) → [{ slotCode, family }, …]
  const map = {};
  for (const slot of slots) {
    for (const m of slot.meetings || []) {
      for (const i of periodsCovered(m, periods)) {
        const key = `${m.day}|${i}`;
        if (!(map[key] ||= []).some((c) => c.slotCode === slot.slotCode)) {
          map[key].push({ slotCode: slot.slotCode, family: slot.family });
        }
      }
    }
  }

  const selectedSet = new Set(selected);
  const lockedSet = new Set(locked);

  return (
    <div className="pref-grid" style={{ gridTemplateColumns: `60px repeat(${periods.length}, minmax(0, 1fr))` }}>
      <div className="header corner">Day</div>
      {periods.map((p) => (
        <div key={p.startMinute} className="header time-col">{periodLabel(p)}</div>
      ))}
      {DAYS.map((d) => (
        <Row
          key={d}
          day={d}
          periods={periods}
          map={map}
          selectedSet={selectedSet}
          lockedSet={lockedSet}
          onToggle={onToggle}
          variant={variant}
        />
      ))}
    </div>
  );
}

function Row({ day, periods, map, selectedSet, lockedSet, onToggle, variant }) {
  return (
    <>
      <div className="day-label">{day}</div>
      {periods.map((p, i) => {
        const chips = map[`${day}|${i}`] || [];
        const isLunch = p.kind === 'lunch';
        return (
          <div key={`${day}-${i}`} className={`cell ${isLunch ? 'lunch' : ''}`}>
            {isLunch && chips.length === 0
              ? <span className="muted" style={{ fontSize: 10 }}>Lunch</span>
              : chips.map((c) => {
                const locked = lockedSet.has(c.slotCode);
                const active = selectedSet.has(c.slotCode);
                const cls = [
                  'chip',
                  active ? `active-${variant}` : '',
                  locked ? 'locked' : '',
                ].filter(Boolean).join(' ');
                return (
                  <button
                    key={c.slotCode}
                    type="button"
                    className={cls}
                    disabled={locked}
                    onClick={() => onToggle(c.slotCode)}
                    title={`${c.slotCode} · ${c.family || ''}`}
                  >
                    {c.slotCode}
                  </button>
                );
              })}
          </div>
        );
      })}
    </>
  );
}
