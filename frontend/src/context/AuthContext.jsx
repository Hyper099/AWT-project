import { createContext, useContext, useEffect, useState } from 'react';

const AuthContext = createContext(null);
const KEY = 'vtop-auth';

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(() => {
    try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; }
  });
  useEffect(() => {
    if (auth) localStorage.setItem(KEY, JSON.stringify(auth));
    else localStorage.removeItem(KEY);
  }, [auth]);
  const value = { auth, login: setAuth, logout: () => setAuth(null) };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
