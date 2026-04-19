const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI'];
const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17];

/**
 * Weekly grid where each cell contains one small chip per slot that meets at
 * that (day, hour). Clicking a chip toggles its slotCode in `selected`.
 *
 * Props:
 *   slots       — all slots from /api/courses/slots
 *   selected    — array of slotCodes currently in the active list
 *   locked      — array of slotCodes that cannot be toggled (already in the other list)
 *   onToggle    — (slotCode) => void
 *   variant     — 'preferred' | 'unavailable' — changes selected-chip style
 */
export default function SlotPreferenceGrid({ slots, selected = [], locked = [], onToggle, variant = 'preferred' }) {
  // Build (day|hour) → [{ slotCode, family }, …]
  const map = {};
  for (const slot of slots) {
    for (const m of slot.meetings || []) {
      const startH = Math.floor(m.startMinute / 60);
      const endH = Math.ceil(m.endMinute / 60);
      for (let h = startH; h < endH; h++) {
        const key = `${m.day}|${h}`;
        (map[key] ||= []).push({ slotCode: slot.slotCode, family: slot.family });
      }
    }
  }
  // Dedupe within each cell
  for (const key of Object.keys(map)) {
    const seen = new Set();
    map[key] = map[key].filter((c) => seen.has(c.slotCode) ? false : (seen.add(c.slotCode), true));
  }

  const selectedSet = new Set(selected);
  const lockedSet = new Set(locked);

  return (
    <div className="pref-grid">
      <div className="header corner">Day</div>
      {HOURS.map((h) => (
        <div key={h} className="header time-col">{String(h).padStart(2, '0')}:00</div>
      ))}
      {DAYS.map((d) => (
        <Row
          key={d}
          day={d}
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

function Row({ day, map, selectedSet, lockedSet, onToggle, variant }) {
  return (
    <>
      <div className="day-label">{day}</div>
      {HOURS.map((h) => {
        const chips = map[`${day}|${h}`] || [];
        const isLunch = h === 13;
        return (
          <div key={`${day}-${h}`} className={`cell ${isLunch ? 'lunch' : ''}`}>
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
