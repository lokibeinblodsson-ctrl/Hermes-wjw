import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../App";
import DataPage from "./DataPage";

type Tab = "users" | "tasks" | "categories" | "audit" | "analytics" | "flags" | "settings" | "data";

export default function AdminPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = (searchParams.get("tab") as Tab) || "users";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [error, setError] = useState("");

  if (user?.role !== "admin" && user?.role !== "moderator") {
    return <div className="error">Admin access required.</div>;
  }

  return (
    <div className="admin-page">
      <div className="admin-tabs">
        {(["users", "tasks", "categories", "audit", "analytics", "flags", "settings"] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => { setTab(t); setError(""); }}>{t}</button>
        ))}
        {(user?.role === "admin" || user?.role === "moderator") && (
          <button className={tab === "data" ? "active" : ""} onClick={() => { setTab("data"); setError(""); }}>data</button>
        )}
      </div>
      {error && <div className="error">{error}</div>}
      {tab === "users" && <UsersTab setError={setError} />}
      {tab === "tasks" && <TasksTab setError={setError} />}
      {tab === "categories" && <CategoriesTab setError={setError} />}
      {tab === "audit" && <AuditTab isAdmin={user?.role === "admin"} setError={setError} />}
      {tab === "analytics" && <AnalyticsTab setError={setError} />}
      {tab === "flags" && <FlagsTab setError={setError} />}
      {tab === "settings" && <SettingsTab setError={setError} />}
      {tab === "data" && <DataPage />}
    </div>
  );
}

function useReload() {
  const [, setN] = useState(0);
  return () => setN((n) => n + 1);
}

// ── Users ──────────────────────────────────────────────────────────────────
function UsersTab({ setError }: { setError: (s: string) => void }) {
  const [users, setUsers] = useState<any[]>([]);
  const reload = useReload();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");

  async function load() {
    try { const r = await api.get("/admin/users"); setUsers(r.data); } catch (e: any) { setError(e.message); }
  }
  useEffect(() => { load(); }, [reload]);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    try { await api.post("/admin/users", { email: inviteEmail, role: inviteRole }); setInviteEmail(""); reload(); }
    catch (e: any) { setError(e.message); }
  }
  async function setStatus(id: string, status: string) {
    try {
      if (status === "disabled") await api.post(`/admin/users/${id}/disable`);
      else if (status === "active") await api.post(`/admin/users/${id}/enable`);
      else await api.patch(`/admin/users/${id}`, { status });
      reload();
    } catch (e: any) { setError(e.message); }
  }
  async function setRole(id: string, role: string) {
    try { await api.patch(`/admin/users/${id}`, { role }); reload(); } catch (e: any) { setError(e.message); }
  }
  async function forceReset(id: string) {
    try { await api.post(`/admin/users/${id}/force-reset`); reload(); } catch (e: any) { setError(e.message); }
  }
  async function remove(id: string) {
    if (!confirm("Remove this user permanently?")) return;
    try { await api.delete(`/admin/users/${id}`); reload(); } catch (e: any) { setError(e.message); }
  }

  return (
    <div>
      <form onSubmit={invite} className="toolbar-inline">
        <input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="invite email" required />
        <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
          <option value="member">member</option>
          <option value="reviewer">reviewer</option>
          <option value="moderator">moderator</option>
          <option value="admin">admin</option>
        </select>
        <button className="btn-primary">Invite user</button>
      </form>
      <table className="data-table">
        <thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Status</th><th>Verified</th><th>Actions</th></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.email}</td>
              <td>{u.display_name}</td>
              <td>
                <select value={u.role} onChange={(e) => setRole(u.id, e.target.value)}>
                  <option value="member">member</option>
                  <option value="reviewer">reviewer</option>
                  <option value="moderator">moderator</option>
                  <option value="admin">admin</option>
                </select>
              </td>
              <td>
                <select value={u.status} onChange={(e) => setStatus(u.id, e.target.value)}>
                  <option value="active">active</option>
                  <option value="disabled">disabled</option>
                  <option value="invited">invited</option>
                  <option value="suspended">suspended</option>
                </select>
              </td>
              <td>{u.email_verified ? "✓" : "✗"}</td>
              <td>
                <button className="btn-link" onClick={() => forceReset(u.id)}>reset pw</button>
                <button className="btn-link danger" onClick={() => remove(u.id)}>delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Tasks ──────────────────────────────────────────────────────────────────
function TasksTab({ setError }: { setError: (s: string) => void }) {
  const [tasks, setTasks] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignee, setAssignee] = useState("");
  const [priority, setPriority] = useState("medium");
  const reload = useReload();

  async function load() {
    try {
      const [t, u] = await Promise.all([api.get("/admin/tasks"), api.get("/admin/users")]);
      setTasks(t.data); setUsers(u.data);
    } catch (e: any) { setError(e.message); }
  }
  useEffect(() => { load(); }, [reload]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try { await api.post("/admin/tasks", { title, description, assignee_id: assignee || null, priority }); setTitle(""); setDescription(""); setAssignee(""); reload(); }
    catch (e: any) { setError(e.message); }
  }
  async function update(id: string, patch: any) { try { await api.patch(`/admin/tasks/${id}`, patch); reload(); } catch (e: any) { setError(e.message); } }
  async function showHistory(id: string) {
    try { const r = await api.get(`/admin/tasks/${id}/history`); alert(JSON.stringify(r.data, null, 2)); } catch (e: any) { setError(e.message); }
  }

  return (
    <div>
      <form onSubmit={create} className="task-form">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title" required />
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" rows={2} />
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">Unassigned</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.display_name}</option>)}
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value)}>
          {["low", "medium", "high", "urgent"].map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button className="btn-primary">Assign task</button>
      </form>
      <table className="data-table">
        <thead><tr><th>Title</th><th>Assignee</th><th>Status</th><th>Priority</th><th>Due</th><th>Actions</th></tr></thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id}>
              <td>{t.title}</td>
              <td>{users.find((u) => u.id === t.assignee_id)?.display_name || "—"}</td>
              <td>
                <select value={t.status} onChange={(e) => update(t.id, { status: e.target.value })}>
                  {["open", "in_progress", "blocked", "done", "cancelled"].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </td>
              <td>
                <select value={t.priority} onChange={(e) => update(t.id, { priority: e.target.value })}>
                  {["low", "medium", "high", "urgent"].map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </td>
              <td>{t.due_date ? t.due_date.slice(0, 10) : "—"}</td>
              <td><button className="btn-link" onClick={() => showHistory(t.id)}>history</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Categories ────────────────────────────────────────────────────────────
function CategoriesTab({ setError }: { setError: (s: string) => void }) {
  const [cats, setCats] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#7c9c64");
  const [description, setDescription] = useState("");
  const reload = useReload();

  async function load() { try { const r = await api.get("/board/categories"); setCats(r.data); } catch (e: any) { setError(e.message); } }
  useEffect(() => { load(); }, [reload]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    try { await api.post("/board/categories", { name, color, description }); setName(""); setDescription(""); reload(); }
    catch (e: any) { setError(e.message); }
  }
  async function del(id: string) { if (!confirm("Delete category? Cards will be unassigned (not deleted).")) return; try { await api.delete(`/board/categories/${id}`); reload(); } catch (e: any) { setError(e.message); } }
  async function reorder() {
    const ids = cats.map((c) => c.id);
    try { await api.post("/board/categories/reorder", { ids }); reload(); } catch (e: any) { setError(e.message); }
  }

  return (
    <div>
      <form onSubmit={add} className="toolbar-inline">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Category name" required />
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" />
        <button className="btn-primary">Add</button>
      </form>
      <table className="data-table">
        <thead><tr><th>Name</th><th>Color</th><th>Description</th><th>Actions</th></tr></thead>
        <tbody>
          {cats.map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td><span className="swatch" style={{ background: c.color }} /></td>
              <td>{c.description}</td>
              <td><button className="btn-link danger" onClick={() => del(c.id)}>delete</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="btn-link" onClick={reorder}>Re-save order (by list)</button>
    </div>
  );
}

// ── Audit ──────────────────────────────────────────────────────────────────
function AuditTab({ isAdmin, setError }: { isAdmin: boolean; setError: (s: string) => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const reload = useReload();
  async function load() { try { const r = await api.get("/admin/audit?limit=100"); setRows(r.data); } catch (e: any) { setError(e.message); } }
  useEffect(() => { load(); }, [reload]);
  async function exportCsv() {
    try { const r = await api.get("/admin/audit/export"); const csv = toCsv(r.data); download("audit-export.json", JSON.stringify(r.data, null, 2)); }
    catch (e: any) { setError(e.message); }
  }
  return (
    <div>
      <div className="toolbar-inline"><button className="btn-link" onClick={exportCsv}>Export audit log (JSON)</button></div>
      <table className="data-table small">
        <thead><tr><th>Time</th><th>Action</th><th>Actor</th><th>Target</th><th>Meta</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{new Date(r.created_at).toLocaleString()}</td>
              <td>{r.action}</td>
              <td>{r.actor_id || "—"}</td>
              <td>{r.target_type ? `${r.target_type}:${r.target_id}` : "—"}</td>
              <td><code>{JSON.stringify(r.meta)}</code></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Analytics ───────────────────────────────────────────────────────────────
function AnalyticsTab({ setError }: { setError: (s: string) => void }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => { api.get("/admin/analytics").then((r) => setData(r.data)).catch((e) => setError(e.message)); }, []);
  if (!data) return <div className="muted">Loading…</div>;
  const entries = Object.entries(data.by_type_last_30d) as [string, number][];
  return (
    <div>
      <h3>Events (last 30 days)</h3>
      <table className="data-table">
        <thead><tr><th>Event</th><th>Count</th></tr></thead>
        <tbody>
          {entries.length === 0 && <tr><td colSpan={2} className="muted">No events yet.</td></tr>}
          {entries.map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}
        </tbody>
      </table>
    </div>
  );
}

// ── Feature flags ───────────────────────────────────────────────────────────
function FlagsTab({ setError }: { setError: (s: string) => void }) {
  const [flags, setFlags] = useState<any[]>([]);
  async function load() { try { const r = await api.get("/admin/flags"); setFlags(r.data); } catch (e: any) { setError(e.message); } }
  useEffect(() => { load(); }, []);
  async function toggle(f: any) { try { await api.put(`/admin/flags/${f.name}`, { enabled: !f.enabled }); load(); } catch (e: any) { setError(e.message); } }
  return (
    <div>
      <table className="data-table">
        <thead><tr><th>Flag</th><th>Status</th><th>Toggle</th></tr></thead>
        <tbody>
          {flags.map((f) => (
            <tr key={f.name}><td>{f.name}</td><td>{f.enabled ? "ON" : "OFF"}</td>
              <td><button className="btn-link" onClick={() => toggle(f)}>{f.enabled ? "Disable" : "Enable"}</button></td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Settings ────────────────────────────────────────────────────────────────
function SettingsTab({ setError }: { setError: (s: string) => void }) {
  const [settings, setSettings] = useState<any>({});
  async function load() { try { const r = await api.get("/admin/settings"); setSettings(r.data); } catch (e: any) { setError(e.message); } }
  useEffect(() => { load(); }, []);
  async function save(key: string, value: any) { try { await api.put(`/admin/settings/${key}`, value); load(); } catch (e: any) { setError(e.message); } }
  return (
    <div>
      <p className="muted">System settings (JSON values).</p>
      {Object.entries(settings).map(([k, v]) => (
        <div key={k} className="setting-row">
          <code>{k}</code>: <code>{JSON.stringify(v)}</code>
          <button className="btn-link" onClick={() => { const nv = prompt(`New value for ${k} (JSON):`, JSON.stringify(v)); if (nv) try { save(k, JSON.parse(nv)); } catch (e: any) { setError("Invalid JSON"); } }}>edit</button>
        </div>
      ))}
    </div>
  );
}

function toCsv(_rows: any[]): string { return ""; }
function download(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
