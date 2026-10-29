import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import TimetableGrid from '../components/TimetableGrid.jsx';
import SlotPreferenceGrid from '../components/SlotPreferenceGrid.jsx';
import { HOURLY_PERIODS, scheduleSpan } from '../lib/periods.js';

export default function InstructorDashboard() {
  const { auth } = useAuth();
  const [me, setMe] = useState(null);
  const [courses, setCourses] = useState([]);
  const [slots, setSlots] = useState([]);
  const [timetable, setTimetable] = useState([]);
  const [msg, setMsg] = useState('');
  const [preferred, setPreferred] = useState([]);
  const [unavailable, setUnavailable] = useState([]);
  const [teaching, setTeaching] = useState([]);
  const [saving, setSaving] = useState(false);
  const [semesters, setSemesters] = useState([]);
  const [semTab, setSemTab] = useState(null);

  useEffect(() => {
    let cancel = false;
    async function load() {
      const [p, tt, cs, sl, sems] = await Promise.all([
        api.profMe(auth.token),
        api.profTimetable(auth.token).catch(() => []),
        api.profCourses(auth.token).catch(() => []),
        api.slots(auth.token).catch(() => []),
        api.profSemesters(auth.token).catch(() => []),
      ]);
      if (cancel) return;
      setMe(p);
      setPreferred(p.preferredSlots || []);
      setUnavailable(p.unavailableSlots || []);
      setTeaching(p.teachingCourses || p.eligibleCourses || []);
      setTimetable(tt);
      setCourses(cs);
      setSlots(sl);
      setSemesters(sems);
      setSemTab((cur) => cur ?? sems[0]?.semester ?? null);
    }
    load();
    return () => { cancel = true; };
  }, [auth.token]);

  function togglePreferred(slotCode) {
    setPreferred((list) => list.includes(slotCode) ? list.filter((x) => x !== slotCode) : [...list, slotCode]);
  }
  function toggleUnavailable(slotCode) {
    setUnavailable((list) => list.includes(slotCode) ? list.filter((x) => x !== slotCode) : [...list, slotCode]);
  }

  const toggle = (list, setList) => (s) =>
    setList(list.includes(s) ? list.filter((x) => x !== s) : [...list, s]);

  async function save() {
    setSaving(true); setMsg('');
    try {
      const r = await api.profCourseSelect(auth.token, {
        preferredSlots: preferred, unavailableSlots: unavailable, teachingCourses: teaching,
      });
      setMe(r);
      setMsg('Preferences saved.');
    } catch (e) { setMsg(e.message); }
    finally { setSaving(false); }
  }

  // Instructors can teach in several semesters, each with its own bell schedule.
  const activeSem = semesters.find((x) => x.semester === semTab);
  const periods = activeSem?.periods?.length ? activeSem.periods : HOURLY_PERIODS;
  const semSlots = useMemo(() => slots.filter((x) => semTab == null || x.semester === semTab), [slots, semTab]);
  const semRows = useMemo(() => timetable.filter((r) => semTab == null || r.semester === semTab), [timetable, semTab]);
  const sectionCount = (sem) => new Set(timetable.filter((r) => r.semester === sem).map((r) => `${r.courseId}|${r.slotCode}`)).size;

  const courseById = useMemo(
    () => Object.fromEntries(courses.map((c) => [c.courseId, c])),
    [courses],
  );

  /**
   * Group allotment rows into sections keyed by (courseId, slotCode) so each
   * taught class appears once with its meeting summary + enrolment.
   */
  const sections = useMemo(() => {
    const map = {};
    for (const row of timetable) {
      const key = `${row.courseId}|${row.slotCode}`;
      if (!map[key]) {
        map[key] = {
          courseId: row.courseId,
          courseCode: row.courseCode,
          courseTitle: row.courseTitle,
          slotCode: row.slotCode,
          semester: row.semester,
          roomName: row.roomName,
          buildingName: row.buildingName,
          enrolled: row.enrolled ?? 0,
          meetings: [],
        };
      }
      map[key].meetings.push({ day: row.day, start: row.startMinute, end: row.endMinute });
    }
    return Object.values(map);
  }, [timetable]);

  if (!me) return <div className="container"><p className="muted">Loading…</p></div>;

  const teachingLoad = teaching.length;

  return (
    <div className="container">
      <div className="spread" style={{ marginBottom: 24, alignItems: 'flex-start' }}>
        <div>
          <div className="section-label">Faculty portal</div>
          <h1 style={{ marginBottom: 4 }}>{me.name}</h1>
          <div className="muted mono" style={{ fontSize: 13 }}>{me.professorId} · {me.department}</div>
        </div>
        <div className="stat-grid" style={{ minWidth: 360 }}>
          <div className="stat"><div className="label">Eligible courses</div><div className="value">{(me.eligibleCourses || []).length}</div></div>
          <div className="stat"><div className="label">Teaching load</div><div className="value">{teachingLoad}</div></div>
          <div className="stat"><div className="label">Sections</div><div className="value">{sections.length}</div></div>
        </div>
      </div>

      {semesters.length > 1 && (
        <div className="row tight" style={{ marginBottom: 16 }} role="tablist" aria-label="Semester">
          {semesters.map((x) => (
            <button
              key={x.semester}
              role="tab"
              aria-selected={semTab === x.semester}
              className={semTab === x.semester ? 'sm' : 'secondary sm'}
              onClick={() => setSemTab(x.semester)}
            >
              {x.name} · {sectionCount(x.semester)} {sectionCount(x.semester) === 1 ? 'section' : 'sections'}
            </button>
          ))}
        </div>
      )}

      <div className="card">
        <h2>Your weekly schedule{activeSem ? ` · ${activeSem.name}` : ''}</h2>
        <p className="muted" style={{ marginBottom: 16 }}>
          Rooms and timings as published for the current term · {scheduleSpan(periods)}
        </p>
        {semRows.length === 0 ? (
          <div className="empty">
            <div className="title">{timetable.length ? 'No classes in this semester' : 'Timetable not yet published'}</div>
            <div>Once the academic office runs the scheduler your sessions will appear here.</div>
          </div>
        ) : (
          <TimetableGrid periods={periods} rows={semRows.map((r) => ({ ...r, state: 'allotted' }))} readOnly />
        )}
      </div>

      {sections.length > 0 && (
        <div className="card">
          <h2>Sections assigned to you</h2>
          <p className="muted" style={{ marginBottom: 12 }}>One row per section, with venue and enrolment.</p>
          <table>
            <thead>
              <tr>
                <th>Sem</th>
                <th>Code</th>
                <th>Title</th>
                <th>Credits</th>
                <th>Kind</th>
                <th>Slot</th>
                <th>Room</th>
                <th>Building</th>
                <th style={{ textAlign: 'right' }}>Students</th>
              </tr>
            </thead>
            <tbody>
              {sections.map((s) => {
                const c = courseById[s.courseId];
                return (
                  <tr key={`${s.courseId}-${s.slotCode}`}>
                    <td>{s.semester ?? c?.semester ?? '—'}</td>
                    <td className="mono">{s.courseCode || c?.code || s.courseId}</td>
                    <td>{s.courseTitle || c?.title || '—'}</td>
                    <td>{c?.credits ?? '—'}</td>
                    <td style={{ textTransform: 'capitalize' }}>{c?.type || '—'}</td>
                    <td><span className="tag">{s.slotCode}</span></td>
                    <td>{s.roomName || '—'}</td>
                    <td>{s.buildingName || '—'}</td>
                    <td style={{ textAlign: 'right' }}>{s.enrolled}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h2>Courses you can teach</h2>
        <p className="muted" style={{ marginBottom: 12 }}>Tick the courses you would like to be considered for this term.</p>
        {(me.eligibleCourses || []).length === 0 ? (
          <div className="empty">
            <div className="title">No courses configured in your profile</div>
            <div>Reach out to the academic office to update your eligibility.</div>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Teach</th>
                <th>Sem</th>
                <th>Code</th>
                <th>Title</th>
                <th>Department</th>
                <th>Credits</th>
                <th>Kind</th>
                <th>Slot family</th>
              </tr>
            </thead>
            <tbody>
              {(me.eligibleCourses || []).map((cid) => {
                const c = courseById[cid];
                return (
                  <tr key={cid}>
                    <td>
                      <input
                        type="checkbox"
                        checked={teaching.includes(cid)}
                        onChange={() => toggle(teaching, setTeaching)(cid)}
                        style={{ width: 'auto' }}
                      />
                    </td>
                    <td>{c?.semester ?? '—'}</td>
                    <td className="mono">{c?.code || cid}</td>
                    <td>{c?.title || '—'}</td>
                    <td>{c?.department || '—'}</td>
                    <td>{c?.credits ?? '—'}</td>
                    <td style={{ textTransform: 'capitalize' }}>{c?.type || '—'}</td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{c?.slotFamily || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Preferred time slots{activeSem ? ` · ${activeSem.name}` : ''}</h2>
        <p className="muted" style={{ marginBottom: 12 }}>
          Tap a chip to indicate a slot you would prefer to teach in. The scheduler will treat this as a soft preference.
          {preferred.length > 0 && <> · <strong>{preferred.length} selected</strong></>}
        </p>
        <SlotPreferenceGrid
          slots={semSlots}
          periods={periods}
          selected={preferred}
          locked={unavailable}
          onToggle={togglePreferred}
          variant="preferred"
        />
      </div>

      <div className="card">
        <h2>Unavailable time slots{activeSem ? ` · ${activeSem.name}` : ''}</h2>
        <p className="muted" style={{ marginBottom: 12 }}>
          A hard constraint — the scheduler will not place you at these times. Slots you marked as preferred are disabled here.
          {unavailable.length > 0 && <> · <strong>{unavailable.length} selected</strong></>}
        </p>
        <SlotPreferenceGrid
          slots={semSlots}
          periods={periods}
          selected={unavailable}
          locked={preferred}
          onToggle={toggleUnavailable}
          variant="unavailable"
        />
      </div>

      <div className="spread" style={{ marginTop: 8 }}>
        <span className="muted">{msg}</span>
        <button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save preferences'}</button>
      </div>
    </div>
  );
}
