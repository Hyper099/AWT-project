const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI'];
const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17];

function fmt(h) { return `${String(h).padStart(2, '0')}:00`; }

/**
 * Renders a weekly timetable grid with DAYS as rows and HOURS as columns.
 *
 * Props:
 *  - cells: (day|hour) → { state, title, code, meta, extra, … }
 *  - rows: legacy meeting rows; painted as allotted cells
 *  - onCellClick(day, hour, cell)
 *  - readOnly: disables clicks
 */
export default function TimetableGrid({ cells, rows, onCellClick, readOnly }) {
  const map = {};
  if (cells) for (const [k, v] of Object.entries(cells)) map[k] = v;
  if (rows) {
    for (const r of rows) {
      const startH = Math.floor(r.startMinute / 60);
      const endH = Math.ceil(r.endMinute / 60);
      for (let h = startH; h < endH; h++) {
        const key = `${r.day}|${h}`;
        if (!map[key]) {
          map[key] = {
            state: r.state || 'allotted',
            title: r.courseCode,
            meta: [r.roomName, r.buildingName].filter(Boolean).join(' · '),
            extra: r.professorName,
            code: r.slotCode,
          };
        }
      }
    }
  }

  return (
    <div className="grid-tt-flipped">
      <div className="header corner">Day</div>
      {HOURS.map((h) => (
        <div key={h} className="header time-col">{fmt(h)}</div>
      ))}
      {DAYS.map((d) => (
        <Row key={d} day={d} map={map} onCellClick={onCellClick} readOnly={readOnly} />
      ))}
    </div>
  );
}

function Row({ day, map, onCellClick, readOnly }) {
  return (
    <>
      <div className="day-label">{day}</div>
      {HOURS.map((h) => {
        const isLunch = h === 13;
        if (isLunch) {
          return (
            <div key={`${day}-${h}`} className="cell lunch">
              <span className="slot-code">Lunch</span>
            </div>
          );
        }
        const cell = map[`${day}|${h}`];
        const state = cell?.state || 'available';
        const clickable = !readOnly && onCellClick && state !== 'locked' && state !== 'conflict';
        const className = `cell slot-cell ${state}`;
        const onClick = clickable ? () => onCellClick(day, h, cell) : undefined;
        return (
          <div key={`${day}-${h}`} className={className} onClick={onClick} role={clickable ? 'button' : undefined} tabIndex={clickable ? 0 : -1}>
            {cell?.title && <span className="slot-title">{cell.title}</span>}
            {cell?.code && <span className="slot-code">{cell.code}</span>}
            {cell?.meta && <span className="slot-meta">{cell.meta}</span>}
            {cell?.extra && <span className="slot-meta">{cell.extra}</span>}
            {!cell && <span className="slot-code" style={{ color: 'var(--text-faint)' }}>·</span>}
          </div>
        );
      })}
    </>
  );
}
