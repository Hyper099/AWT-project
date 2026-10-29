import { DAYS, HOURLY_PERIODS, periodLabel, periodsCovered } from '../lib/periods.js';

/**
 * Renders a weekly timetable grid with DAYS as rows and the semester's
 * periods as columns.
 *
 * Props:
 *  - periods: [{ startMinute, endMinute, kind }] — defaults to 09:00–18:00 hourly
 *  - cells: (day|periodIndex) → { state, title, code, meta, extra, … }
 *  - rows: meeting rows; painted as allotted cells
 *  - onCellClick(day, periodIndex, cell)
 *  - readOnly: disables clicks
 */
export default function TimetableGrid({ periods = HOURLY_PERIODS, cells, rows, onCellClick, readOnly }) {
  const map = {};
  if (cells) for (const [k, v] of Object.entries(cells)) map[k] = v;
  if (rows) {
    for (const r of rows) {
      for (const i of periodsCovered(r, periods)) {
        const key = `${r.day}|${i}`;
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
    <div className="grid-tt-flipped" style={{ gridTemplateColumns: `60px repeat(${periods.length}, minmax(0, 1fr))` }}>
      <div className="header corner">Day</div>
      {periods.map((p) => (
        <div key={p.startMinute} className="header time-col">{periodLabel(p)}</div>
      ))}
      {DAYS.map((d) => (
        <Row key={d} day={d} periods={periods} map={map} onCellClick={onCellClick} readOnly={readOnly} />
      ))}
    </div>
  );
}

function Row({ day, periods, map, onCellClick, readOnly }) {
  return (
    <>
      <div className="day-label">{day}</div>
      {periods.map((p, i) => {
        const cell = map[`${day}|${i}`];
        if (p.kind === 'lunch' && !cell) {
          return (
            <div key={`${day}-${i}`} className="cell lunch">
              <span className="slot-code">Lunch</span>
            </div>
          );
        }
        const state = cell?.state || 'available';
        const clickable = !readOnly && onCellClick && state !== 'locked' && state !== 'conflict';
        const className = `cell slot-cell ${state}`;
        const onClick = clickable ? () => onCellClick(day, i, cell) : undefined;
        return (
          <div key={`${day}-${i}`} className={className} onClick={onClick} role={clickable ? 'button' : undefined} tabIndex={clickable ? 0 : -1}>
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
