import { useState, useEffect } from "react";
import Dashboard from "./pages/Dashboard.js";
import Login from "./pages/Login.js";

/**
 * Root component. Handles top-level auth state.
 * If the user is logged in, show the Dashboard.
 * If not, show the Login page.
 *
 * Auth state is derived from a lightweight /api/auth/me check on mount.
 * No token is stored in JS memory — the HTTP-only cookie does the work.
 */
export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  // Check if the user has a valid session on first load.
  // null = still checking, true = logged in, false = not logged in.
  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((res) => setAuthed(res.ok))
      .catch(() => setAuthed(false));
  }, []);

  // Still checking — show nothing to avoid a flash of the login page.
  if (authed === null) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <span className="text-slate-400 text-sm">Loading...</span>
      </div>
    );
  }

  return authed ? (
    <Dashboard onLogout={() => setAuthed(false)} />
  ) : (
    <Login onLogin={() => setAuthed(true)} />
  );
}