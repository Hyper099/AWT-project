import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import TimetableGrid from '../components/TimetableGrid.jsx';
import { DEFAULT_TERM_ID } from '../constants/term.js';
import { useAuth } from '../context/AuthContext.jsx';

function fmt(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function slotsOverlap(a, b) {
  for (const m1 of a.meetings || []) {
    for (const m2 of b.meetings || []) {
      if (m1.day !== m2.day) continue;
      if (m1.startMinute < m2.endMinute && m2.startMinute < m1.endMinute) return true;
    }
  }
  return false;
}

function slotCoversCell(slot, day, hour) {
  return (slot.meetings || []).some((m) => {
    if (m.day !== day) return false;
    const startH = Math.floor(m.startMinute / 60);
    const endH = Math.ceil(m.endMinute / 60);
    return hour >= startH && hour < endH;
  });
}

export default function StudentPortal() {
  const { auth } = useAuth();
  const [me, setMe] = useState(null);
  const [offerings, setOfferings] = useState([]);
  const [regs, setRegs] = useState([]);
  const [status, setStatus] = useState(null);
  const [timetable, setTimetable] = useState([]);
  const [slots, setSlots] = useState([]);
  const [picker, setPicker] = useState(null); // { day, hour, combos, stage, selected }
  const [dropTarget, setDropTarget] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [downloading, setDownloading] = useState(false);

  const loadAll = useCallback(async () => {
    setErr('');
    try {
      const [m, o, r, s, tt, sl] = await Promise.all([
        api.studentMe(auth.token),
        api.studentOfferings(auth.token),
        api.studentRegs(auth.token),
        api.studentTimetableStatus(auth.token),
        api.studentTimetable(auth.token),
        api.slots(auth.token),
      ]);
      setMe(m); setOfferings(o); setRegs(r); setStatus(s); setTimetable(tt); setSlots(sl);
    } catch (e) { setErr(e.message); }
  }, [auth.token]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const slotByCode = useMemo(
    () => Object.fromEntries(slots.map((s) => [s.slotCode, s])),
    [slots],
  );
  const regByCourse = useMemo(() => Object.fromEntries(regs.map((r) => [r.courseId, r])), [regs]);
  const allottedCourseIds = useMemo(() => new Set(timetable.map((t) => t.courseId)), [timetable]);
  const allotted = status?.allotted;
  const registeredSlots = useMemo(
    () => regs.map((r) => slotByCode[r.slotCode]).filter(Boolean),
    [regs, slotByCode],
  );
  const offeringsByCourse = useMemo(
    () => Object.fromEntries(offerings.map((o) => [o.offering.courseId, o])),
    [offerings],
  );

  /** (day|hour) → cell descriptor */
  const cells = useMemo(() => {
    const map = {};

    // baseline: any slot covering this cell is "available"
    for (const slot of slots) {
      for (const m of slot.meetings || []) {
        const startH = Math.floor(m.startMinute / 60);
        const endH = Math.ceil(m.endMinute / 60);
        for (let h = startH; h < endH; h++) {
          const key = `${m.day}|${h}`;
          if (!map[key]) map[key] = { state: 'available', code: slot.slotCode, slotCode: slot.slotCode };
        }
      }
    }
    // selected: from registrations
    for (const reg of regs) {
      const slot = slotByCode[reg.slotCode];
      const entry = offeringsByCourse[reg.courseId];
      const course = entry?.course;
      if (!slot) continue;
      for (const m of slot.meetings || []) {
        const startH = Math.floor(m.startMinute / 60);
        const endH = Math.ceil(m.endMinute / 60);
        for (let h = startH; h < endH; h++) {
          const key = `${m.day}|${h}`;
          map[key] = {
            state: 'selected',
            code: slot.slotCode,
            slotCode: slot.slotCode,
            title: course?.code || reg.courseId,
            meta: 'selected',
            courseId: reg.courseId,
          };
        }
      }
    }
    // conflict overlay
    if (!allotted) {
      for (const key of Object.keys(map)) {
        const cell = map[key];
        if (cell.state !== 'available') continue;
        const slot = slotByCode[cell.slotCode];
        if (!slot) continue;
        const conflicts = registeredSlots.some((reg) => reg.slotCode !== slot.slotCode && slotsOverlap(reg, slot));
        if (conflicts) map[key] = { ...cell, state: 'conflict' };
      }
    }
    // allotted overlay from timetable
    if (allotted) {
      for (const row of timetable) {
        const startH = Math.floor(row.startMinute / 60);
        const endH = Math.ceil(row.endMinute / 60);
        for (let h = startH; h < endH; h++) {
          const key = `${row.day}|${h}`;
          map[key] = {
            state: 'allotted',
            title: row.courseCode,
            code: row.slotCode,
            meta: [row.roomName, row.buildingName].filter(Boolean).join(' · '),
            extra: row.professorName,
          };
        }
      }
    }
    return map;
  }, [slots, regs, slotByCode, offeringsByCourse, registeredSlots, timetable, allotted]);

  function handleCellClick(day, hour, cell) {
    if (!cell) return;
    if (cell.state === 'allotted') return;
    if (cell.state === 'selected') {
      setDropTarget({ courseId: cell.courseId, slotCode: cell.slotCode });
      return;
    }
    if (cell.state !== 'available') return;

    // Offerings available for this cell. A course is available here iff the
    // cell is covered by a slot whose family matches the course family.
    const coveringSlots = slots.filter((s) => slotCoversCell(s, day, hour));
    const combos = [];
    for (const slot of coveringSlots) {
      const clashes = registeredSlots.some((r) => r.slotCode !== slot.slotCode && slotsOverlap(r, slot));
      if (clashes) continue;
      for (const o of offerings) {
        if (o.selected) continue;
        const family = o.course?.slotFamily || 'THEORY_3';
        if (family !== slot.family) continue;
        combos.push({ offering: o.offering, course: o.course, slot });
      }
    }
    setPicker({ day, hour, combos, stage: 'course', selected: null, professors: null, loading: false });
  }

  async function onPickCourse(combo) {
    setPicker((p) => ({ ...p, stage: 'professor', selected: combo, professors: null, loading: true }));
    try {
      const profs = await api.studentProfessors(auth.token, combo.course.courseId);
      setPicker((p) => p && p.selected?.course.courseId === combo.course.courseId
        ? { ...p, professors: profs, loading: false } : p);
    } catch (e) { setErr(e.message); setPicker(null); }
  }

  async function onPickProfessor(professorId) {
    if (!picker?.selected) return;
    setErr(''); setMsg('');
    try {
      await api.register(auth.token, {
        courseId: picker.selected.course.courseId,
        slotCode: picker.selected.slot.slotCode,
        professorId,
      });
      setMsg(`Added ${picker.selected.course.code} · ${picker.selected.slot.slotCode}`);
      setPicker(null);
      await loadAll();
    } catch (e) { setErr(e.message); }
  }

  async function handleDrop() {
    if (!dropTarget) return;
    setErr(''); setMsg('');
    try {
      await api.unregister(auth.token, dropTarget.courseId);
      setMsg(`Removed ${dropTarget.courseId}`);
      setDropTarget(null);
      await loadAll();
    } catch (e) { setErr(e.message); }
  }

  async function download(format) {
    setDownloading(true); setErr('');
    try { await api.downloadTimetable(auth.token, format); }
    catch (e) { setErr(e.message); }
    finally { setDownloading(false); }
  }

  if (!me) return <div className="container"><p className="muted">Loading…</p></div>;
  const termId = status?.termId || DEFAULT_TERM_ID;

  const selectedCount = offerings.filter((o) => o.selected).length;
  const allottedCount = offerings.filter((o) => allottedCourseIds.has(o.offering.courseId)).length;
  const creditsSelected = offerings.filter((o) => o.selected).reduce((sum, o) => sum + (o.course?.credits || 0), 0);

  return (
    <div className="container">
      <div className="spread" style={{ marginBottom: 24, gap: 24, alignItems: 'flex-start' }}>
        <div>
          <div className="section-label">My semester</div>
          <h1 style={{ marginBottom: 4 }}>{me.name}</h1>
          <div className="muted mono" style={{ fontSize: 13 }}>
            {me.studentId} · {[me.program, me.branch].filter(Boolean).join(' · ')} · Semester {me.semester}
          </div>
        </div>
        <div className="stat-grid" style={{ minWidth: 440 }}>
          <div className="stat"><div className="label">Term</div><div className="value" style={{ fontSize: 14 }}>{termId}</div></div>
          <div className="stat"><div className="label">Offered</div><div className="value">{offerings.length}</div></div>
          <div className="stat"><div className="label">Selected</div><div className="value">{selectedCount}</div></div>
          <div className="stat"><div className="label">Credits</div><div className="value">{creditsSelected}</div></div>
        </div>
      </div>

      <div className={`banner ${allotted ? 'dark' : ''}`}>
        <div>
          <div className="banner-title">{allotted ? 'Your timetable is live' : 'Choose your courses'}</div>
          <div className="banner-sub">
            {allotted
              ? 'Rooms, buildings, and faculty have been finalised. Download a copy for your records.'
              : 'Pick from the offered courses or click a free slot on the grid. Conflicting hours are marked as unavailable.'}
          </div>
        </div>
        {allotted && (
          <div className="row tight" style={{ flex: 'unset' }}>
            <button className="secondary sm" disabled={downloading} onClick={() => download('csv')}>CSV</button>
            <button className="sm" disabled={downloading} onClick={() => download('pdf')}>
              {downloading ? 'Preparing…' : 'Download PDF'}
            </button>
          </div>
        )}
      </div>

      {err && <div className="card" style={{ borderColor: 'var(--danger)' }}><span className="error">{err}</span></div>}
      {msg && <div className="muted" style={{ marginBottom: 16 }}>{msg}</div>}

      <div className="card">
        <h2 style={{ marginBottom: 4 }}>Courses on offer this semester</h2>
        <p className="muted" style={{ marginBottom: 16 }}>
          {selectedCount} of {offerings.length} chosen · {allottedCount} finalised
        </p>
        {offerings.length === 0 ? (
          <div className="empty">
            <div className="title">No courses configured</div>
            <div>Your department has not yet published offerings for this term.</div>
          </div>
        ) : (
          <table>
            <thead>
              <tr><th>Code</th><th>Title</th><th>Department</th><th>Credits</th><th>Kind</th><th>Status</th><th style={{ textAlign: 'right' }}></th></tr>
            </thead>
            <tbody>
              {offerings.map((o) => {
                const reg = regByCourse[o.offering.courseId];
                const isAllotted = allottedCourseIds.has(o.offering.courseId);
                let state;
                if (isAllotted) state = { label: 'Allotted', cls: 'solid' };
                else if (reg) state = { label: 'Selected', cls: 'ghost' };
                else state = { label: 'Pending', cls: '' };
                return (
                  <tr key={o.offering.courseOfferingId}>
                    <td className="mono">{o.course?.code || o.offering.courseId}</td>
                    <td>{o.course?.title || '—'}</td>
                    <td>{o.course?.department || '—'}</td>
                    <td>{o.course?.credits ?? '—'}</td>
                    <td style={{ textTransform: 'capitalize' }}>{o.course?.type || '—'}</td>
                    <td><span className={`tag ${state.cls}`}>{state.label}</span></td>
                    <td style={{ textAlign: 'right' }}>
                      {!allotted && reg && (
                        <button className="secondary sm" onClick={() => setDropTarget({ courseId: reg.courseId, slotCode: reg.slotCode })}>Drop</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="spread" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ marginBottom: 2 }}>Weekly schedule</h2>
            <p className="muted" style={{ margin: 0 }}>Monday to Friday · 09:00 – 18:00</p>
          </div>
          <Legend />
        </div>
        <TimetableGrid cells={cells} onCellClick={handleCellClick} readOnly={allotted} />
      </div>

      {picker && (
        <Picker
          day={picker.day}
          hour={picker.hour}
          stage={picker.stage}
          combos={picker.combos}
          selected={picker.selected}
          professors={picker.professors}
          loading={picker.loading}
          onPickCourse={onPickCourse}
          onPickProfessor={onPickProfessor}
          onBack={() => setPicker((p) => p ? { ...p, stage: 'course', selected: null, professors: null } : p)}
          onClose={() => setPicker(null)}
        />
      )}

      {dropTarget && (
        <Confirm
          title={`Drop ${dropTarget.courseId}?`}
          detail={`Slot ${dropTarget.slotCode} will become available again.`}
          onCancel={() => setDropTarget(null)}
          onConfirm={handleDrop}
        />
      )}
    </div>
  );
}

function Legend() {
  return (
    <span className="muted" style={{ fontSize: 11.5, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
      <LegendSwatch className="available" /> Available
      <LegendSwatch className="selected" /> Selected
      <LegendSwatch className="conflict" /> Conflict
      <LegendSwatch className="allotted" /> Allotted
    </span>
  );
}
function LegendSwatch({ className }) {
  return <span style={{ display: 'inline-block', width: 14, height: 14, marginRight: 4, verticalAlign: 'middle', border: '1px solid var(--border-strong)' }} className={`slot-cell ${className}`} />;
}

function Picker({ day, hour, stage, combos, selected, professors, loading, onPickCourse, onPickProfessor, onBack, onClose }) {
  const grouped = {};
  for (const c of combos) {
    if (!grouped[c.slot.slotCode]) grouped[c.slot.slotCode] = { slot: c.slot, items: [] };
    grouped[c.slot.slotCode].items.push(c);
  }
  const slotCodes = Object.keys(grouped);

  return (
    <div className="picker-backdrop" onClick={onClose}>
      <div className="picker picker-wide" onClick={(e) => e.stopPropagation()}>
        <div className="section-label">{day} · {String(hour).padStart(2, '0')}:00</div>
        {stage === 'course' && (
          <>
            <h3>Add a course</h3>
            {slotCodes.length === 0 ? (
              <div className="empty">
                <div className="title">Nothing fits here</div>
                <div>No offering in your batch has a slot covering this cell (or all would clash).</div>
              </div>
            ) : (
              slotCodes.map((code) => {
                const g = grouped[code];
                const meetingSummary = (g.slot.meetings || []).map((m) => `${m.day} ${fmt(m.startMinute)}–${fmt(m.endMinute)}`).join(', ');
                return (
                  <div key={code} style={{ marginBottom: 16 }}>
                    <div className="spread" style={{ marginBottom: 8 }}>
                      <div>
                        <span className="tag solid mono">{code}</span>
                        <span className="faint"> {g.slot.family || g.slot.type}</span>
                      </div>
                      <span className="faint" style={{ fontSize: 11.5 }}>{meetingSummary}</span>
                    </div>
                    <div className="picker-list">
                      {g.items.map((c) => (
                        <div key={c.course.courseId} className="picker-item" onClick={() => onPickCourse(c)}>
                          <div>
                            <div style={{ fontWeight: 500 }}>{c.course.title}</div>
                            <div className="faint"><span className="mono">{c.course.code}</span> · {c.course.department} · {c.course.credits} cr</div>
                          </div>
                          <span className="tag">{c.course.type}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
            <div className="picker-actions">
              <button className="secondary" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
        {stage === 'professor' && selected && (
          <>
            <div className="spread" style={{ marginBottom: 12 }}>
              <div>
                <h3 style={{ marginBottom: 2 }}>{selected.course.title}</h3>
                <div className="faint"><span className="mono">{selected.course.code}</span> · Slot <span className="mono">{selected.slot.slotCode}</span></div>
              </div>
              <button className="ghost sm" onClick={onBack}>← Back</button>
            </div>
            <div className="two-col-picker">
              <div>
                <div className="section-label">Course</div>
                <div className="stack" style={{ gap: 6 }}>
                  <div><span className="faint">Department</span> <strong>{selected.course.department}</strong></div>
                  <div><span className="faint">Credits</span> <strong>{selected.course.credits}</strong></div>
                  <div><span className="faint">Type</span> <strong style={{ textTransform: 'capitalize' }}>{selected.course.type}</strong></div>
                  <div><span className="faint">Weekly hours</span> <strong>{selected.course.weeklyHours}</strong></div>
                </div>
              </div>
              <div>
                <div className="section-label">Pick an instructor</div>
                {loading && <p className="muted">Loading…</p>}
                {!loading && professors && professors.length === 0 && (
                  <div className="empty">
                    <div className="title">No instructors available</div>
                    <div>This course has no eligible instructors configured.</div>
                  </div>
                )}
                {!loading && professors && professors.length > 0 && (
                  <div className="picker-list" style={{ maxHeight: 340 }}>
                    {professors.map((p) => {
                      const full = p.seatsRemaining === 0;
                      return (
                        <button
                          key={p.professorId}
                          type="button"
                          className="picker-item picker-button"
                          disabled={full}
                          onClick={() => onPickProfessor(p.professorId)}
                          style={full ? { cursor: 'not-allowed', opacity: 0.55 } : undefined}
                        >
                          <div style={{ textAlign: 'left' }}>
                            <div style={{ fontWeight: 500 }}>{p.name}</div>
                            <div className="faint"><span className="mono">{p.professorId}</span> · {p.department}</div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div className={`tag ${full ? '' : 'solid'}`}>{p.maxStudents} seats</div>
                            {full && <div className="faint" style={{ fontSize: 10.5, marginTop: 4 }}>Full</div>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            <div className="picker-actions">
              <button className="secondary" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Confirm({ title, detail, onCancel, onConfirm }) {
  return (
    <div className="picker-backdrop" onClick={onCancel}>
      <div className="picker" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p className="muted">{detail}</p>
        <div className="picker-actions">
          <button className="secondary" onClick={onCancel}>Cancel</button>
          <button className="danger" onClick={onConfirm}>Drop</button>
        </div>
      </div>
    </div>
  );
}
