import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, setToken, setCurrentUser } from "../lib/api";
import { useAuth } from "../App";
import PasswordField from "../components/PasswordField";

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "reset-request" | "reset-do" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const { refresh } = useAuth();

  async function doLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const res = await api.post("/auth/login", { email, password });
      setToken(res.data.token);
      setCurrentUser(res.data.user);
      await refresh();
      navigate("/");
    } catch (e: any) {
      setErr(e.message || "Login failed");
    } finally {
      setBusy(false);
    }
  }

  async function doResetRequest(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await api.post("/auth/request-password-reset", { email });
      setMsg("If the email exists, a reset link was sent.");
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function doResetDo(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await api.post("/auth/reset-password", { token: resetToken, password: newPassword });
      setMsg("Password reset. Please log in.");
      setMode("login");
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="centered-card">
      <h1>🌿 Wild Jazmine Wellness</h1>
      {err && <div className="error">{err}</div>}
      {msg && <div className="success">{msg}</div>}

      {mode === "login" && (
        <form onSubmit={doLogin}>
          <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <PasswordField placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <button className="btn-primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
          <div className="form-links">
            <button type="button" className="btn-link" onClick={() => setMode("reset-request")}>Forgot password?</button>
          </div>
        </form>
      )}

      {mode === "reset-request" && (
        <form onSubmit={doResetRequest}>
          <input type="email" placeholder="Your email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <button className="btn-primary" disabled={busy}>Send reset link</button>
          <div className="form-links"><button type="button" className="btn-link" onClick={() => setMode("login")}>Back</button></div>
        </form>
      )}

      {mode === "reset-do" && (
        <form onSubmit={doResetDo}>
          <input placeholder="Reset token from email" value={resetToken} onChange={(e) => setResetToken(e.target.value)} required />
          <PasswordField placeholder="New password (min 8)" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} />
          <button className="btn-primary" disabled={busy}>Reset password</button>
        </form>
      )}
    </div>
  );
}
