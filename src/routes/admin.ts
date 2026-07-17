// Admin routes: user CRUD, role/status, tasks + assignment + history,
// audit logs, analytics, feature flags, settings, category mgmt passthrough,
// and RAG memory endpoints.
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { Env } from "../lib/env";
import type { User } from "../lib/types";
import { json, jsonError, Errors } from "../lib/errors";
import { userUpdateSchema, taskCreateSchema, taskUpdateSchema, memoryCreateSchema, memoryQuerySchema, inviteSchema } from "../lib/validation";
import { randomId, nowIso, toJson, jsonField } from "../lib/crypto";
import { resolveSession, listUsers, getUserById, getUserByEmail } from "../db/users";
import { logAudit, logAnalytics, getAnalyticsSummary } from "../db/logging";
import { addMemory, retrieveMemory, recallSince, logDecision, logChangelog } from "../db/memory";
import { requireRole } from "../lib/auth";
import { sendEmail, inviteEmailHtml } from "../lib/email";
import { siteName } from "../lib/env";

const admin = new Hono<{ Bindings: Env; Variables: { admin: User } }>();
type D1DatabaseLike = import("@cloudflare/workers-types").D1Database;

async function me(db: D1DatabaseLike, c: any): Promise<ReturnType<typeof resolveSession>> {
  const auth = c.req.raw.headers.get("authorization");
  if (!auth) return null;
  try {
    const { verifyJwt } = await import("../lib/jwt");
    const p = await verifyJwt(auth.replace(/^Bearer /, ""));
    return resolveSession(db, p.sub, p.tv || 0);
  } catch {
    return null;
  }
}

// Guard: all admin routes require admin role.
admin.use("*", async (c, next) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  requireRole(user, "admin");
  c.set("admin", user);
  await next();
});

// ── Users ────────────────────────────────────────────────────────────────
admin.get("/users", async (c) => {
  const users = await listUsers(c.env.DB);
  const safe = users.map((u) => ({ ...u, password_hash: undefined }));
  return json({ ok: true, data: safe });
});

admin.get("/users/:id", async (c) => {
  const u = await getUserById(c.env.DB, c.req.param("id"));
  if (!u) return jsonError(Errors.notFound());
  return json({ ok: true, data: { ...u, password_hash: undefined } });
});

admin.post("/users", zValidator("json", inviteSchema), async (c) => {
  const adminUser = c.get("admin") as any;
  const body = await c.req.json();
  const existing = await getUserByEmail(c.env.DB, body.email);
  if (existing) return jsonError(Errors.conflict("Email already registered"));
  const userId = randomId("usr");
  const inviteToken = randomTokenLocal();
  await c.env.DB.prepare(
    `INSERT INTO users (id, email, display_name, password_hash, role, status, email_verified, force_reset, token_version, created_at, updated_at, invited_by, invite_token)
     VALUES (?, ?, ?, '', ?, 'invited', 0, 1, 0, ?, ?, ?, ?)`
  ).bind(userId, body.email, body.display_name || body.email.split("@")[0], body.role, nowIso(), nowIso(), adminUser.id, inviteToken).run();
  const link = `${new URL(c.req.url).origin}/accept-invite?token=${inviteToken}`;
  await sendEmail(c.env, c.env.DB, body.email, `You're invited to ${siteName(c.env)}`, inviteEmailHtml(siteName(c.env), link));
  await logAudit(c.env.DB, { actorId: adminUser.id, action: "admin_invite_user", targetType: "user", targetId: userId, meta: { email: body.email, role: body.role } });
  await logAnalytics(c.env.DB, "admin_invitation_sent", userId);
  return json({ ok: true, data: { id: userId } }, 201);
});

admin.patch("/users/:id", zValidator("json", userUpdateSchema), async (c) => {
  const adminUser = c.get("admin") as any;
  const id = c.req.param("id");
  const target = await getUserById(c.env.DB, id);
  if (!target) return jsonError(Errors.notFound());
  // prevent self role/disable lockout
  if (id === adminUser.id && (("role" in (await c.req.json())) || (await c.req.json()).status === "disabled")) {
    return jsonError(Errors.badRequest("You cannot change your own role or disable yourself"));
  }
  const body = await c.req.json();
  const sets: string[] = []; const params: unknown[] = [];
  for (const f of ["display_name", "role", "status", "email_verified", "force_reset"]) {
    if (f in body && body[f] !== undefined) {
      sets.push(`${f} = ?`);
      params.push(f === "email_verified" || f === "force_reset" ? (body[f] ? 1 : 0) : body[f]);
    }
  }
  if (sets.length === 0) return jsonError(Errors.badRequest("Nothing to update"));
  sets.push("updated_at = ?"); params.push(nowIso());
  params.push(id);
  await c.env.DB.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).bind(...(params as never[])).run();
  await logAudit(c.env.DB, { actorId: adminUser.id, action: "admin_update_user", targetType: "user", targetId: id, meta: body });
  await logAnalytics(c.env.DB, "admin_user_updated", id);
  return json({ ok: true });
});

admin.delete("/users/:id", async (c) => {
  const adminUser = c.get("admin") as any;
  const id = c.req.param("id");
  if (id === adminUser.id) return jsonError(Errors.badRequest("Cannot delete yourself"));
  const target = await getUserById(c.env.DB, id);
  if (!target) return jsonError(Errors.notFound());
  await c.env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(id).run();
  await logAudit(c.env.DB, { actorId: adminUser.id, action: "admin_delete_user", targetType: "user", targetId: id });
  return json({ ok: true });
});

admin.post("/users/:id/disable", async (c) => {
  const adminUser = c.get("admin") as any;
  const id = c.req.param("id");
  if (id === adminUser.id) return jsonError(Errors.badRequest("Cannot disable yourself"));
  await c.env.DB.prepare(`UPDATE users SET status = 'disabled', updated_at = ? WHERE id = ?`).bind(nowIso(), id).run();
  await logAudit(c.env.DB, { actorId: adminUser.id, action: "admin_disable_user", targetType: "user", targetId: id });
  return json({ ok: true });
});

admin.post("/users/:id/enable", async (c) => {
  const adminUser = c.get("admin") as any;
  const id = c.req.param("id");
  await c.env.DB.prepare(`UPDATE users SET status = 'active', updated_at = ? WHERE id = ?`).bind(nowIso(), id).run();
  await logAudit(c.env.DB, { actorId: adminUser.id, action: "admin_enable_user", targetType: "user", targetId: id });
  return json({ ok: true });
});

// ── Tasks (assignment) ───────────────────────────────────────────────────
admin.get("/tasks", async (c) => {
  const rs = await c.env.DB.prepare(`SELECT * FROM tasks ORDER BY created_at DESC`).all();
  return json({ ok: true, data: rs.results || [] });
});

admin.post("/tasks", zValidator("json", taskCreateSchema), async (c) => {
  const adminUser = c.get("admin") as any;
  const body = await c.req.json();
  const id = randomId("tsk");
  await c.env.DB.prepare(
    `INSERT INTO tasks (id, title, description, assignee_id, creator_id, due_date, status, priority, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, body.title, body.description || "", body.assignee_id ?? null, adminUser.id, body.due_date ?? null, body.status || "open", body.priority || "medium", nowIso(), nowIso()).run();
  await c.env.DB.prepare(`INSERT INTO task_history (id, task_id, actor_id, action, to_state, note, created_at) VALUES (?, ?, ?, 'created', ?, '', ?)`)
    .bind(randomId("th"), id, adminUser.id, body.status || "open", nowIso()).run();
  if (body.assignee_id) {
    await c.env.DB.prepare(`INSERT INTO task_history (id, task_id, actor_id, action, to_state, note, created_at) VALUES (?, ?, ?, 'assigned', ?, '', ?)`)
      .bind(randomId("th"), id, adminUser.id, body.assignee_id, nowIso()).run();
  }
  await logAudit(c.env.DB, { actorId: adminUser.id, action: "task_created", targetType: "task", targetId: id, meta: { assignee_id: body.assignee_id } });
  await logAnalytics(c.env.DB, "task_created", adminUser.id, { assignee_id: body.assignee_id });
  return json({ ok: true, data: { id } }, 201);
});

admin.patch("/tasks/:id", zValidator("json", taskUpdateSchema), async (c) => {
  const adminUser = c.get("admin") as any;
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare(`SELECT * FROM tasks WHERE id = ?`).bind(id).first();
  if (!existing) return jsonError(Errors.notFound());
  const e = existing as any;
  const body = await c.req.json();
  const sets: string[] = []; const params: unknown[] = [];
  const meta: Record<string, unknown> = {};
  for (const f of ["title", "description", "assignee_id", "due_date", "priority"]) {
    if (f in body && body[f] !== undefined) { sets.push(`${f} = ?`); params.push(body[f]); meta[f] = body[f]; }
  }
  if ("status" in body && body.status !== undefined && body.status !== e.status) {
    sets.push("status = ?"); params.push(body.status);
    await c.env.DB.prepare(`INSERT INTO task_history (id, task_id, actor_id, action, from_state, to_state, created_at) VALUES (?, ?, ?, 'status_changed', ?, ?, ?)`)
      .bind(randomId("th"), id, adminUser.id, e.status, body.status, nowIso()).run();
  } else if ("assignee_id" in body && body.assignee_id !== e.assignee_id) {
    await c.env.DB.prepare(`INSERT INTO task_history (id, task_id, actor_id, action, from_state, to_state, created_at) VALUES (?, ?, ?, 'reassigned', ?, ?, ?)`)
      .bind(randomId("th"), id, adminUser.id, e.assignee_id || "none", body.assignee_id || "none", nowIso()).run();
  }
  if (sets.length === 0) return jsonError(Errors.badRequest("Nothing to update"));
  sets.push("updated_at = ?"); params.push(nowIso());
  params.push(id);
  await c.env.DB.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).bind(...(params as never[])).run();
  await logAudit(c.env.DB, { actorId: adminUser.id, action: "task_updated", targetType: "task", targetId: id, meta });
  await logAnalytics(c.env.DB, "task_updated", adminUser.id, { task_id: id });
  return json({ ok: true });
});

admin.get("/tasks/:id/history", async (c) => {
  const rs = await c.env.DB.prepare(`SELECT * FROM task_history WHERE task_id = ? ORDER BY created_at ASC`).bind(c.req.param("id")).all();
  return json({ ok: true, data: rs.results || [] });
});

// ── Audit & analytics ─────────────────────────────────────────────────────
admin.get("/audit", async (c) => {
  const limit = Math.min(200, parseInt(new URL(c.req.url).searchParams.get("limit") || "50"));
  const rs = await c.env.DB.prepare(`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?`).bind(limit).all();
  const rows = ((rs.results as any[]) || []).map((r) => ({ ...r, meta: jsonField(r.meta_json, {}) }));
  return json({ ok: true, data: rows });
});

admin.get("/audit/export", async (c) => {
  const rs = await c.env.DB.prepare(`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 5000`).all();
  const rows = ((rs.results as any[]) || []).map((r) => ({ ...r, meta: jsonField(r.meta_json, {}) }));
  return json({ ok: true, data: rows });
});

admin.get("/analytics", async (c) => {
  const summary = await getAnalyticsSummary(c.env.DB);
  const rs = await c.env.DB.prepare(`SELECT event_type, COUNT(*) as c FROM analytics_events GROUP BY event_type`).bind().all();
  const all: Record<string, number> = {};
  for (const r of (rs.results as { event_type: string; c: number }[]) || []) all[r.event_type] = r.c;
  return json({ ok: true, data: { by_type_all: all, by_type_last_30d: summary } });
});

// ── Feature flags ─────────────────────────────────────────────────────────
admin.get("/flags", async (c) => {
  const rs = await c.env.DB.prepare(`SELECT * FROM feature_flags ORDER BY name`).all();
  return json({ ok: true, data: rs.results || [] });
});

admin.put("/flags/:name", async (c) => {
  const adminUser = c.get("admin") as any;
  const name = c.req.param("name");
  const body = await c.req.json().catch(() => ({}));
  const enabled = body.enabled ? 1 : 0;
  await c.env.DB.prepare(
    `INSERT INTO feature_flags (name, enabled, description, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET enabled = ?, description = ?, updated_at = ?, updated_by = ?`
  ).bind(name, enabled, body.description || "", nowIso(), adminUser.id, enabled, body.description || "", nowIso(), adminUser.id).run();
  await logAudit(c.env.DB, { actorId: adminUser.id, action: "flag_updated", targetType: "flag", targetId: name, meta: { enabled } });
  return json({ ok: true });
});

// ── Settings ───────────────────────────────────────────────────────────────
admin.get("/settings", async (c) => {
  const rs = await c.env.DB.prepare(`SELECT * FROM settings`).all();
  const out: Record<string, unknown> = {};
  for (const r of (rs.results as { key: string; value_json: string }[]) || []) out[r.key] = jsonField(r.value_json, null);
  return json({ ok: true, data: out });
});

admin.put("/settings/:key", async (c) => {
  const adminUser = c.get("admin") as any;
  const key = c.req.param("key");
  const body = await c.req.json().catch(() => null);
  if (body === null) return jsonError(Errors.badRequest("JSON body required"));
  await c.env.DB.prepare(
    `INSERT INTO settings (key, value_json, updated_at, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = ?, updated_at = ?, updated_by = ?`
  ).bind(key, toJson(body), nowIso(), adminUser.id, toJson(body), nowIso(), adminUser.id).run();
  await logAudit(c.env.DB, { actorId: adminUser.id, action: "setting_updated", targetType: "setting", targetId: key });
  return json({ ok: true });
});

// ── Email verification admin control ──────────────────────────────────────
admin.get("/email-verification", async (c) => {
  const rs = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.display_name, u.email_verified, u.status, u.role FROM users u ORDER BY u.created_at DESC`
  ).all();
  return json({ ok: true, data: rs.results || [] });
});

// ── Password reset admin control ──────────────────────────────────────────
admin.post("/users/:id/force-reset", async (c) => {
  const adminUser = c.get("admin") as any;
  const id = c.req.param("id");
  const newToken = randomTokenLocal();
  await c.env.DB.prepare(`UPDATE users SET force_reset = 1, token_version = token_version + 1 WHERE id = ?`).bind(id).run();
  await logAudit(c.env.DB, { actorId: adminUser.id, action: "admin_force_reset", targetType: "user", targetId: id });
  return json({ ok: true, data: { message: "User will be forced to reset password on next login", reset_token: newToken } });
});

// ── RAG Memory (admin) ─────────────────────────────────────────────────────
admin.get("/memory", async (c) => {
  const limit = Math.min(100, parseInt(new URL(c.req.url).searchParams.get("limit") || "50"));
  const rs = await c.env.DB.prepare(`SELECT id, type, title, summary, tags_json, created_at, updated_at FROM memory_notes ORDER BY updated_at DESC LIMIT ?`).bind(limit).all();
  const rows = ((rs.results as any[]) || []).map((r) => ({ ...r, tags: jsonField(r.tags_json, []) }));
  return json({ ok: true, data: rows });
});

admin.post("/memory", zValidator("json", memoryCreateSchema), async (c) => {
  const adminUser = c.get("admin") as any;
  const body = await c.req.json();
  const id = await addMemory(c.env.DB, { ...body, created_by: adminUser.id });
  await logAudit(c.env.DB, { actorId: adminUser.id, action: "memory_added", targetType: "memory", targetId: id, meta: { type: body.type } });
  return json({ ok: true, data: { id } }, 201);
});

admin.post("/memory/decision", async (c) => {
  const adminUser = c.get("admin") as any;
  const { title, body } = await c.req.json();
  const id = await logDecision(c.env.DB, title, body || "", adminUser.id);
  return json({ ok: true, data: { id } }, 201);
});

admin.post("/memory/changelog", async (c) => {
  const adminUser = c.get("admin") as any;
  const { title, body } = await c.req.json();
  const id = await logChangelog(c.env.DB, title, body || "", adminUser.id);
  return json({ ok: true, data: { id } }, 201);
});

export default admin;

function randomTokenLocal(): string {
  const buf = crypto.getRandomValues(new Uint8Array(24));
  let s = "";
  for (const b of buf) s += b.toString(16).padStart(2, "0");
  return s;
}
