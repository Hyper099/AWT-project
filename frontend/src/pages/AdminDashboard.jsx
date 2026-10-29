import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { DEFAULT_TERM_ID } from '../constants/term.js';
import { useAuth } from '../context/AuthContext.jsx';

function publishSummary(r) {
  const scope = r.semester ? `Semester ${r.semester} timetable` : 'Timetable';
  if (r.complete) {
    return `${scope} published. All ${r.assigned} sections have rooms; ${r.notifications.sent} students notified.`;
  }
  return `Timetable incomplete: ${r.unplacedSections} of ${r.sections} sections (${r.unplacedRegistrations} registrations) `
    + `could not get a room. ${r.studentsComplete} students with a complete timetable were notified; `
    + `${r.studentsIncomplete} were not. See the run summary below.`;
}

export default function AdminDashboard() {
  const { auth } = useAuth();
  const [termId, setTermId] = useState(DEFAULT_TERM_ID);
  const [batchId, setBatchId] = useState('');
  const [semester, setSemester] = useState('');
  const [batches, setBatches] = useState([]);
  const [semesters, setSemesters] = useState([]);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [lastRun, setLastRun] = useState(null);

  const load = useCallback(async () => {
    setErr('');
    try {
      const [b, s, sems] = await Promise.all([
        api.adminBatches(auth.token),
        api.adminStatus(auth.token, { termId, batchId: batchId || null, semester: semester || null }),
        api.adminSemesters(auth.token, termId),
      ]);
      setBatches(b);
      setStatus(s);
      setSemesters(sems);
    } catch (e) { setErr(e.message); }
  }, [auth.token, termId, batchId, semester]);

  useEffect(() => { load(); }, [load]);

  const semesterOptions = useMemo(() => {
    if (semesters.length) return semesters.map((x) => x.semester);
    return [...new Set(batches.map((b) => b.semester).filter(Boolean))].sort((a, b) => a - b);
  }, [batches, semesters]);
  const filteredBatches = useMemo(() => {
    if (!semester) return batches;
    return batches.filter((b) => String(b.semester) === String(semester));
  }, [batches, semester]);

  async function runAction(action, fn, label) {
    setBusy(action); setErr(''); setMsg(''); setLastRun(null);
    try {
      const r = await fn();
      setMsg(typeof label === 'function' ? label(r) : label);
      setLastRun(r);
      await load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(null); setConfirm(null); }
  }

  const totals = status?.totals;
  const incompleteRun = lastRun && lastRun.complete === false;

  return (
    <div className="container">
      <div className="section-label">Academic Operations</div>
      <h1>Timetable control centre</h1>
      <p className="muted" style={{ marginBottom: 24 }}>
        Stage 1 — <strong>Make Slots</strong> applies each semester's programme (every core course,
        one option from each elective basket, and the matching lab sessions) and places each student
        into an instructor and time slot. Stage 2 — <strong>Publish Timetable</strong> allocates rooms
        and buildings, then emails each student whose timetable is complete. Semesters share rooms and
        faculty, so a semester can be published on its own and the others are worked around.
      </p>

      {semesters.length > 0 && (
        <div className="card">
          <h2>Semesters this term</h2>
          <p className="muted" style={{ marginBottom: 12 }}>Pick a row to scope everything below to that semester.</p>
          <table>
            <thead>
              <tr>
                <th>Semester</th><th>Batches</th><th>Students</th><th>Registered</th>
                <th>Timetable issued</th><th>Sections</th><th>Credits</th><th>Source</th><th></th>
              </tr>
            </thead>
            <tbody>
              {semesters.map((x) => (
                <tr key={x.semester} style={String(semester) === String(x.semester) ? { background: 'var(--bg-soft)' } : undefined}>
                  <td><strong>{x.name}</strong></td>
                  <td>{x.batches.length}</td>
                  <td>{x.totals.students}</td>
                  <td>{x.totals.fullySelected} / {x.totals.students}</td>
                  <td>{x.totals.studentsAllotted} / {x.totals.students}</td>
                  <td>{x.totals.sections}</td>
                  <td>{x.creditsRequired}</td>
                  <td className="faint" style={{ fontSize: 12 }}>{x.timetableSource || '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      className={String(semester) === String(x.semester) ? 'sm' : 'secondary sm'}
                      onClick={() => { setSemester(String(semester) === String(x.semester) ? '' : String(x.semester)); setBatchId(''); }}
                    >{String(semester) === String(x.semester) ? 'Show all' : 'Select'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card pad-lg">
        <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="form-row" style={{ marginBottom: 0, flex: '1 1 180px' }}>
            <label>Term</label>
            <input value={termId} onChange={(e) => setTermId(e.target.value)} />
          </div>
          <div className="form-row" style={{ marginBottom: 0, flex: '1 1 140px' }}>
            <label>Semester</label>
            <select value={semester} onChange={(e) => { setSemester(e.target.value); setBatchId(''); }}>
              <option value="">All</option>
              {semesterOptions.map((s) => <option key={s} value={s}>Sem {s}</option>)}
            </select>
          </div>
          <div className="form-row" style={{ marginBottom: 0, flex: '2 1 280px' }}>
            <label>Batch</label>
            <select value={batchId} onChange={(e) => setBatchId(e.target.value)}>
              <option value="">All batches</option>
              {filteredBatches.map((b) => (
                <option key={b.batchId} value={b.batchId}>{b.batchName} ({b.strength})</option>
              ))}
            </select>
          </div>
          <div className="row tight" style={{ flex: '0 0 auto' }}>
            <button
              className="secondary"
              onClick={() => setConfirm({ type: 'allot', scope: scopeLabel() })}
              disabled={Boolean(busy)}
            >Make Slots</button>
            <button
              onClick={() => setConfirm({ type: 'schedule', scope: publishScope() })}
              disabled={Boolean(busy) || !scheduleReady()}
              title={scheduleReady() ? undefined : 'All students must be fully selected before running the scheduler.'}
            >{busy === 'schedule' ? 'Publishing…' : 'Publish Timetable'}</button>
          </div>
        </div>
      </div>

      {err && (
        <div className="card" style={{ borderColor: 'var(--danger)' }}>
          <span className="error">{err}</span>
          {/not all students are fully selected/i.test(err) && (
            <div style={{ marginTop: 12 }}>
              <button
                className="secondary sm"
                onClick={() => setConfirm({ type: 'schedule', scope: publishScope(), force: true })}
                disabled={Boolean(busy)}
              >Run anyway (force)</button>
              <span className="muted" style={{ marginLeft: 10, fontSize: 12 }}>
                Skip the guard and schedule only the students who have selections.
              </span>
            </div>
          )}
        </div>
      )}
      {msg && (
        <div className={incompleteRun ? 'error' : 'muted'} style={{ marginBottom: 12 }} role="status">{msg}</div>
      )}

      {totals && (
        <>
          <div className="stat-grid" style={{ marginBottom: 20 }}>
            <div className="stat"><div className="label">Students in scope</div><div className="value">{totals.students}</div></div>
            <div className="stat"><div className="label">Fully registered</div><div className="value">{totals.fullySelected}</div></div>
            <div className="stat"><div className="label">In progress</div><div className="value">{totals.partial}</div></div>
            <div className="stat"><div className="label">Not started</div><div className="value">{totals.none}</div></div>
            <div className="stat"><div className="label">Timetable issued</div><div className="value">{totals.studentsAllotted}</div></div>
            <div className="stat"><div className="label">Faculty at capacity</div><div className="value">{totals.fullyBookedProfessors}</div></div>
          </div>

          <div className="two-col">
            <div className="card">
              <h2>Registration progress by batch</h2>
              <p className="muted" style={{ marginBottom: 12 }}>Complete · In progress · Not started</p>
              {Object.keys(status.byBatch).length === 0 ? (
                <div className="empty"><div className="title">No students in scope</div></div>
              ) : (
                <table>
                  <thead>
                    <tr><th>Batch</th><th>Complete</th><th>In&nbsp;progress</th><th>Not&nbsp;started</th><th>Total</th></tr>
                  </thead>
                  <tbody>
                    {Object.entries(status.byBatch).map(([bid, s]) => (
                      <tr key={bid}>
                        <td className="mono" style={{ fontSize: 12 }}>{bid}</td>
                        <td>{s.full}</td>
                        <td>{s.partial}</td>
                        <td>{s.none}</td>
                        <td>{s.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="card">
              <h2>Faculty seat availability</h2>
              <p className="muted" style={{ marginBottom: 12 }}>Courses marked <em>Full</em> are closed for new selections.</p>
              <div style={{ maxHeight: 320, overflow: 'auto' }}>
                <table>
                  <thead>
                    <tr><th>Instructor</th><th>Course</th><th style={{ textAlign: 'right' }}>Seats</th></tr>
                  </thead>
                  <tbody>
                    {status.professorCourseStatus
                      .sort((a, b) => (b.full - a.full) || (a.seatsRemaining - b.seatsRemaining))
                      .slice(0, 40)
                      .map((p) => (
                        <tr key={`${p.professorId}-${p.courseId}`}>
                          <td><span className="mono" style={{ fontSize: 12 }}>{p.professorId}</span> {p.professorName}</td>
                          <td className="mono" style={{ fontSize: 12 }}>{p.courseId}</td>
                          <td style={{ textAlign: 'right' }}>
                            {p.full
                              ? <span className="tag" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>Full</span>
                              : `${p.maxStudents} seats`
                            }
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}

      <div className="card">
        <h2>Term administration</h2>
        <p className="muted" style={{ marginBottom: 16 }}>
          The options below are destructive — please confirm the scope before proceeding.
          Equivalent CLI routines are also available to the ops team.
        </p>
        <div className="row tight" style={{ flexWrap: 'wrap' }}>
          <button className="secondary" onClick={() => setConfirm({ type: 'resetSel', scope: scopeLabel() })} disabled={Boolean(busy)}>
            Clear selections
          </button>
          <button className="secondary" onClick={() => setConfirm({ type: 'resetAll', scope: publishScope() })} disabled={Boolean(busy)}>
            {semester ? `Reset semester ${semester}` : 'Reset term'}
          </button>
          <button className="secondary" onClick={() => setConfirm({ type: 'allocateAll', scope: publishScope() })} disabled={Boolean(busy)}>
            Auto-allocate cohort
          </button>
        </div>
      </div>

      {lastRun && (
        <div className="card">
          <h2>Last run · summary</h2>
          <pre style={{ background: 'var(--bg-subtle)', padding: 16, borderRadius: 4, overflow: 'auto', fontSize: 12 }}>
{JSON.stringify(lastRun, null, 2)}
          </pre>
        </div>
      )}

      {confirm && (
        <ConfirmDialog
          confirm={confirm}
          busy={busy}
          onCancel={() => setConfirm(null)}
          onRun={async () => {
            const opts = { termId, batchId: batchId || undefined, semester: semester || undefined };
            if (confirm.type === 'allot')
              await runAction('allot', () => api.adminAllotSlots(auth.token, opts), 'Slots generated.');
            if (confirm.type === 'schedule')
              await runAction('schedule', () => api.generate(auth.token, termId, { force: confirm.force, semester: semester || null }), publishSummary);
            if (confirm.type === 'resetSel')
              await runAction('resetSel', () => api.adminResetSelections(auth.token, opts), 'Selections cleared.');
            if (confirm.type === 'resetAll')
              await runAction('resetAll', () => api.adminResetAllocation(auth.token, { termId, semester: semester || undefined }), semester ? `Semester ${semester} reset.` : 'Term reset.');
            if (confirm.type === 'allocateAll')
              await runAction('allocateAll', () => api.adminAllocateAll(auth.token, { termId, semester: semester || undefined }), 'Cohort allocated.');
          }}
        />
      )}
    </div>
  );

  function scopeLabel() {
    if (batchId) return `batch ${batchId}`;
    if (semester) return `semester ${semester}`;
    return `term ${termId}`;
  }
  /** Publishing and resets work on a whole semester (or the term), never a single batch. */
  function publishScope() {
    return semester ? `semester ${semester}` : `term ${termId}`;
  }
  function scheduleReady() {
    const t = status?.totals;
    if (!t || t.students === 0) return false;
    return t.partial === 0 && t.none === 0;
  }
}

function ConfirmDialog({ confirm, busy, onCancel, onRun }) {
  const titles = {
    allot: 'Make slots for ' + confirm.scope + '?',
    schedule: 'Publish timetable for ' + confirm.scope + '?',
    resetSel: 'Clear selections for ' + confirm.scope + '?',
    resetAll: 'Reset the term for ' + confirm.scope + '?',
    allocateAll: 'Auto-allocate every student in ' + confirm.scope + '?',
  };
  const details = {
    allot: 'Every student without a complete selection will be auto-placed into the remaining eligible sections, respecting professor seat caps.',
    schedule: 'Assigns rooms & buildings to every section in scope and emails each student their final timetable. Other semesters keep their published timetable.',
    resetSel: 'Removes selection records in scope. Seat counters are recomputed automatically.',
    resetAll: 'Removes all selections and timetable entries in scope and recomputes every professor seat counter.',
    allocateAll: 'Resets the scope and runs the slot-making routine for every student in it, around the other semesters.',
  };
  return (
    <div className="picker-backdrop" onClick={onCancel}>
      <div className="picker" onClick={(e) => e.stopPropagation()}>
        <h3>{titles[confirm.type]}</h3>
        <p className="muted">{details[confirm.type]}</p>
        <div className="picker-actions">
          <button className="secondary" onClick={onCancel} disabled={Boolean(busy)}>Cancel</button>
          <button onClick={onRun} disabled={Boolean(busy)}>{busy ? 'Running…' : 'Confirm'}</button>
        </div>
      </div>
    </div>
  );
}
