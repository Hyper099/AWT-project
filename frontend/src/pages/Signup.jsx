import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function Signup() {
  const [form, setForm] = useState({
    username: '', password: '', role: 'student',
    displayName: '', studentId: '', professorId: '', email: '',
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const { login } = useAuth();
  const nav = useNavigate();

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const res = await api.signup(form);
      login(res);
      nav(res.user.role === 'student' ? '/student' : '/instructor');
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="section-label">Campus Timetable</div>
        <h1>Create account</h1>
        <p className="sub">Institution-issued accounts only. Your student or instructor ID must exist in records.</p>
        <form onSubmit={submit}>
          <div className="form-row">
            <label>Role</label>
            <select value={form.role} onChange={set('role')}>
              <option value="student">Student</option>
              <option value="professor">Instructor</option>
            </select>
          </div>
          <div className="form-row"><label>Username</label><input value={form.username} onChange={set('username')} /></div>
          <div className="form-row"><label>Password</label><input type="password" value={form.password} onChange={set('password')} /></div>
          <div className="form-row"><label>Display name</label><input value={form.displayName} onChange={set('displayName')} /></div>
          <div className="form-row"><label>Email</label><input type="email" value={form.email} onChange={set('email')} /></div>
          {form.role === 'student' ? (
            <div className="form-row"><label>Student ID</label><input value={form.studentId} onChange={set('studentId')} /></div>
          ) : (
            <div className="form-row"><label>Instructor ID</label><input value={form.professorId} onChange={set('professorId')} /></div>
          )}
          {err && <div className="error" style={{ marginBottom: 12 }}>{err}</div>}
          <button disabled={busy} style={{ width: '100%' }}>
            {busy ? 'Creating…' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  );
}
