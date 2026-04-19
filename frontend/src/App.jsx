import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import Login from './pages/Login.jsx';
import Signup from './pages/Signup.jsx';
import StudentPortal from './pages/StudentPortal.jsx';
import InstructorDashboard from './pages/InstructorDashboard.jsx';
import AdminDashboard from './pages/AdminDashboard.jsx';

function homePath(auth) {
  if (!auth) return '/login';
  if (auth.user.role === 'student') return '/student';
  if (auth.user.role === 'professor') return '/instructor';
  if (auth.user.role === 'admin') return '/admin';
  return '/login';
}

function roleLabel(role) {
  if (role === 'professor') return 'Instructor';
  if (role === 'student') return 'Student';
  if (role === 'admin') return 'Admin';
  return role;
}

export default function App() {
  const { auth, logout } = useAuth();
  const nav = useNavigate();
  const hideNav = !auth;
  return (
    <div className="app">
      {!hideNav && (
        <nav className="nav">
          <span className="brand">PDPU · Campus</span>
          {auth?.user?.role === 'student' && (
            <NavLink to="/student">My semester</NavLink>
          )}
          {auth?.user?.role === 'professor' && (
            <NavLink to="/instructor">Teaching</NavLink>
          )}
          {auth?.user?.role === 'admin' && (
            <NavLink to="/admin">Operations</NavLink>
          )}
          <div className="spacer" />
          <span className="who"><strong>{auth.user.displayName}</strong> · {roleLabel(auth.user.role)}</span>
          <button className="secondary sm" onClick={() => { logout(); nav('/login'); }}>Sign out</button>
        </nav>
      )}
      <Routes>
        <Route path="/" element={<Navigate to={homePath(auth)} replace />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/student" element={<Protected role="student"><StudentPortal /></Protected>} />
        <Route path="/instructor" element={<Protected role="professor"><InstructorDashboard /></Protected>} />
        <Route path="/admin" element={<Protected role="admin"><AdminDashboard /></Protected>} />
        {/* Legacy redirects */}
        <Route path="/student/register" element={<Navigate to="/student" replace />} />
        <Route path="/student/timetable" element={<Navigate to="/student" replace />} />
        <Route path="/professor" element={<Navigate to="/instructor" replace />} />
        <Route path="/professor/timetable" element={<Navigate to="/instructor" replace />} />
        <Route path="*" element={<Navigate to={homePath(auth)} replace />} />
      </Routes>
    </div>
  );
}

function Protected({ role, children }) {
  const { auth } = useAuth();
  if (!auth) return <Navigate to="/login" replace />;
  if (role && auth.user.role !== role) return <Navigate to={homePath(auth)} replace />;
  return children;
}
