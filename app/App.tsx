import { useState, useEffect, createContext, useContext, ReactNode } from "react";
import { Routes, Route, Navigate, Link, useLocation, useNavigate } from "react-router-dom";
import { api, getToken, setToken, currentUser, setCurrentUser, ApiUser } from "./lib/api";
import { installBridge, setBridgeNavigate } from "./lib/bridge";
import LoginPage from "./pages/LoginPage";
import KanbanPage from "./pages/KanbanPage";
import ChatPage from "./pages/ChatPage";
import AdminPage from "./pages/AdminPage";
import MemoryPage from "./pages/MemoryPage";
import PublishingPage from "./pages/PublishingPage";
import CardWorkspacePage from "./pages/CardWorkspacePage";
import DocsPage from "./pages/DocsPage";
import CalendarPage from "./pages/CalendarPage";
import FilesPage from "./pages/FilesPage";
import HermesChatDock from "./components/HermesChatDock";
import PasswordField from "./components/PasswordField";

interface AuthCtx {
  user: ApiUser | null;
  setUser: (u: ApiUser | null) => void;
  logout: () => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({ user: null, setUser: () => {}, logout: () => {}, refresh: async () => {} });

export function useAuth() {
  return useContext(Ctx);
}

export default function App() {
  const [user, setUserState] = useState<ApiUser | null>(currentUser());
  const [loading, setLoading] = useState<boolean>(!!getToken());
  const [hermesOpen, setHermesOpen] = useState(false);
  const navigate = useNavigate();

  // Allow any page to open/toggle the Hermes dock (e.g. board toolbar button).
  useEffect(() => {
    const open = () => setHermesOpen(true);
    const toggle = () => setHermesOpen((o) => !o);
    window.addEventListener("wjw:open-hermes", open);
    window.addEventListener("wjw:toggle-hermes", toggle);
    return () => {
      window.removeEventListener("wjw:open-hermes", open);
      window.removeEventListener("wjw:toggle-hermes", toggle);
    };
  }, []);

  // Install the browser bridge once and wire SPA-safe navigation into it.
  useEffect(() => {
    setBridgeNavigate((path) => navigate(path));
    installBridge();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    if (!getToken()) {
      setUserState(null);
      return;
    }
    try {
      const res = await api.get("/auth/me");
      if (res.data.user) {
        const u = res.data.user as ApiUser;
        setUserState(u);
        setCurrentUser(u);
        if (u.force_reset) {
          // route handled in pages; just note it
        }
      } else {
        setUserState(null);
        setToken(null);
        setCurrentUser(null);
      }
    } catch {
      setUserState(null);
      setToken(null);
      setCurrentUser(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setUser(u: ApiUser | null) {
    setUserState(u);
    setCurrentUser(u);
  }
  function logout() {
    api.post("/auth/logout").catch(() => {});
    setToken(null);
    setCurrentUser(null);
    setUserState(null);
  }

  if (loading) return <div className="loading">Loading…</div>;

  if (!user) {
    return (
      <Ctx.Provider value={{ user, setUser, logout, refresh }}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Ctx.Provider>
    );
  }

  if (user.force_reset) {
    return (
      <Ctx.Provider value={{ user, setUser, logout, refresh }}>
        <ForceReset onDone={refresh} />
      </Ctx.Provider>
    );
  }

  return (
    <Ctx.Provider value={{ user, setUser, logout, refresh }}>
      <div className="app-shell">
        <nav className="topnav">
          <Link to="/" className="brand">🌿 Wild Jazmine Wellness</Link>
          <div className="nav-links">
            <Link to="/">Board</Link>
            <Link to="/chat">Chat</Link>
            <Link to="/calendar">Calendar</Link>
            <Link to="/memory">Memory</Link>
            <Link to="/docs">Docs</Link>
            {user.role === "admin" || user.role === "moderator" || user.role === "reviewer" ? <Link to="/publish">Publish</Link> : null}
            {user.role === "admin" || user.role === "moderator" ? <Link to="/files">Files</Link> : null}
            {user.role === "admin" || user.role === "moderator" ? <Link to="/admin">Admin</Link> : null}
          </div>
          <div className="nav-user">
            <span className="badge">{user.role}</span>
            <span className="uname">{user.display_name}</span>
            <button className="btn-link" onClick={() => setHermesOpen((o) => !o)}>🌿 Hermes</button>
            <button onClick={logout} className="btn-link">Logout</button>
          </div>
        </nav>
        <main className={`content ${hermesOpen ? "with-hermes" : ""}`}>
          <Routes>
            <Route path="/" element={<KanbanPage />} />
            <Route path="/card/:id" element={<CardWorkspacePage />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/memory" element={<MemoryPage />} />
            <Route path="/docs" element={<DocsPage />} />
            <Route path="/files" element={<FilesPage />} />
            {user.role === "admin" || user.role === "moderator" || user.role === "reviewer" ? (
              <Route path="/publish" element={<PublishingPage />} />
            ) : null}
            {user.role === "admin" || user.role === "moderator" ? (
              <Route path="/admin/*" element={<AdminPage />} />
            ) : null}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <HermesChatDock open={hermesOpen} onClose={() => setHermesOpen(false)} />
      </div>
    </Ctx.Provider>
  );
}

function ForceReset({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const res = await api.post("/auth/change-password", { current_password: current, new_password: next });
      if (res.data.token) setToken(res.data.token);
      onDone();
    } catch (e: any) {
      setErr(e.message || "Failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="centered-card">
      <h2>Set a new password</h2>
      <p className="muted">Your account requires a password change.</p>
      {err && <div className="error">{err}</div>}
      <form onSubmit={submit}>
        <PasswordField placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        <PasswordField placeholder="New password (min 8)" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} />
        <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Set password"}</button>
      </form>
    </div>
  );
}
