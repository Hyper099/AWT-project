import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function Login() {
  const [username, setU] = useState('');
  const [password, setP] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [showDemo, setShowDemo] = useState(false);
  const { login } = useAuth();
  const nav = useNavigate();

  async function submit(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const res = await api.login({ username: username.trim(), password });
      login(res);
      const r = res.user.role;
      nav(r === 'student' ? '/student' : r === 'admin' ? '/admin' : '/instructor');
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="login-split">
      <aside className="login-hero">
        <div className="login-hero-inner">
          <div className="brand-mark">PDPU · Campus</div>
          <h1>Timetable & Course Registration</h1>
          <p className="lede">
            The institutional portal for managing your semester — pick your preferences,
            view your allotted timetable, and coordinate with faculty, all in one place.
          </p>
          <ul className="hero-points">
            <li><span className="dot" /> Personalised weekly timetable with rooms &amp; faculty</li>
            <li><span className="dot" /> Real-time seat availability across every section</li>
            <li><span className="dot" /> Instant PDF &amp; CSV export once allotment is published</li>
          </ul>
          <div className="hero-foot">
            <span className="mono">Odd Semester · 2025–26</span>
          </div>
        </div>
      </aside>

      <main className="login-panel">
        <div className="login-form-wrap">
          <div className="section-label">Sign in</div>
          <h2>Welcome back</h2>
          <p className="muted" style={{ marginBottom: 28 }}>
            Use your institution-issued credentials to continue.
          </p>

          <form onSubmit={submit}>
            <div className="form-row">
              <label>Username</label>
              <input
                autoFocus
                value={username}
                onChange={(e) => setU(e.target.value)}
                placeholder="Student ID, faculty code, or admin username"
              />
            </div>
            <div className="form-row">
              <label>Password</label>
              <input type="password" value={password} onChange={(e) => setP(e.target.value)} />
            </div>
            {err && <div className="error" style={{ marginBottom: 12 }}>{err}</div>}
            <button type="submit" disabled={busy} style={{ width: '100%' }}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div className="login-foot">
            <button type="button" className="ghost sm" onClick={() => setShowDemo((s) => !s)}>
              {showDemo ? 'Hide sample credentials' : 'Use sample credentials'}
            </button>
            {showDemo && (
              <div className="demo-creds">
                <div><span className="faint">Student · Sem 5</span> <span className="mono">23bcp332</span> · <span className="mono">ts@23bcp332</span></div>
                <div><span className="faint">Student · Sem 7</span> <span className="mono">22bcp601</span> · <span className="mono">ts@22bcp601</span></div>
                <div><span className="faint">Instructor</span> <span className="mono">p12</span> · <span className="mono">welcome@P12</span></div>
                <div><span className="faint">Admin</span> <span className="mono">admin</span> · <span className="mono">admin@123</span></div>
              </div>
            )}
          </div>
        </div>

        <footer className="login-legal">
          <span>© PDPU Campus Services</span>
          <span className="faint">Need help? Contact your academic office.</span>
        </footer>
      </main>
    </div>
  );
}
