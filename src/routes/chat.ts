// Chat (threaded) routes: channels, threads, messages, replies, moderation.
// Permissions: private channels restrict by role; members can post in public ones.
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { Env } from "../lib/env";
import { json, jsonError, Errors } from "../lib/errors";
import { channelCreateSchema, threadCreateSchema, messageCreateSchema } from "../lib/validation";
import { randomId, nowIso, toJson, jsonField } from "../lib/crypto";
import { resolveSession } from "../db/users";
import { logAudit, logAnalytics } from "../db/logging";
import { ensureDefaults } from "../bootstrap";
import { canReadChannel, canManageChannel, type ChannelAccessInput } from "../lib/permissions";
import { isChannelMember, memberChannelIds, listChannelMembers, addChannelMember, removeChannelMember } from "../db/channelMembers";

const chat = new Hono<{ Bindings: Env }>();
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

// Load the access facts for a channel and evaluate them against the user via
// the single permission rule. Returns { ok, channel } so callers can 403/404
// consistently. This is the ONE gate every chat read/write goes through — it
// closes the prior IDOR where thread/message reads had no privacy check.
async function channelAccess(
  db: D1DatabaseLike,
  channelId: string,
  user: { id: string; role: any } | null
): Promise<{ ok: boolean; found: boolean; channel: any }> {
  const ch = await db.prepare(`SELECT * FROM channels WHERE id = ?`).bind(channelId).first();
  if (!ch) return { ok: false, found: false, channel: null };
  const row = ch as any;
  const access: ChannelAccessInput = {
    is_private: !!row.is_private,
    allowed_roles: jsonField(row.allowed_roles_json, []) as any[],
    isMember: user ? await isChannelMember(db as any, channelId, user.id) : false,
  };
  return { ok: canReadChannel(user as any, access), found: true, channel: row };
}

// Same gate, resolved from a thread id (messages are thread-scoped). Returns
// the thread row too so callers can check lock/ownership without re-querying.
async function threadAccess(
  db: D1DatabaseLike,
  threadId: string,
  user: { id: string; role: any } | null
): Promise<{ ok: boolean; found: boolean; thread: any; channel: any }> {
  const t = await db.prepare(`SELECT * FROM threads WHERE id = ?`).bind(threadId).first();
  if (!t) return { ok: false, found: false, thread: null, channel: null };
  const acc = await channelAccess(db, (t as any).channel_id, user);
  return { ok: acc.ok, found: true, thread: t, channel: acc.channel };
}

// ── Channels ─────────────────────────────────────────────────────────────
chat.get("/channels", async (c) => {
  await ensureDefaults(c.env.DB);
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  const rs = await c.env.DB.prepare(`SELECT * FROM channels ORDER BY position ASC`).all();
  const channels = ((rs.results as any[]) || []).map((r) => ({
    ...r,
    allowed_roles: jsonField(r.allowed_roles_json, []),
  }));
  // Visible = public, OR private-and-role-allowed, OR private-and-explicit-member.
  // Per-user membership widens visibility beyond role without leaking others.
  const memberOf = await memberChannelIds(c.env.DB, user.id);
  const visible = channels.filter((ch) =>
    !ch.is_private ||
    (ch.allowed_roles as string[]).includes(user.role) ||
    memberOf.has(ch.id)
  );
  return json({ ok: true, data: visible });
});

chat.post("/channels", zValidator("json", channelCreateSchema), async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  if (user.role !== "admin" && user.role !== "moderator") return jsonError(Errors.forbidden());
  const body = await c.req.json();
  const dup = await c.env.DB.prepare(`SELECT id FROM channels WHERE name = ?`).bind(body.name).first();
  if (dup) return jsonError(Errors.conflict("Channel name already exists"));
  const id = randomId("chn");
  await c.env.DB.prepare(
    `INSERT INTO channels (id, name, description, is_private, allowed_roles_json, position, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position),0)+1 FROM channels), ?, ?)`
  ).bind(id, body.name, body.description || "", body.is_private ? 1 : 0, toJson(body.allowed_roles || []), user.id, nowIso()).run();
  await logAudit(c.env.DB, { actorId: user.id, action: "channel_created", targetType: "channel", targetId: id });
  return json({ ok: true, data: { id, name: body.name } }, 201);
});

// ── Threads ──────────────────────────────────────────────────────────────
chat.get("/threads", async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  const channelId = new URL(c.req.url).searchParams.get("channel_id");
  if (!channelId) return jsonError(Errors.badRequest("channel_id required"));
  const acc = await channelAccess(c.env.DB, channelId, user);
  if (!acc.found) return jsonError(Errors.notFound("Channel not found"));
  if (!acc.ok) return jsonError(Errors.forbidden("Not allowed in this channel"));
  const rs = await c.env.DB.prepare(`SELECT * FROM threads WHERE channel_id = ? ORDER BY pinned DESC, updated_at DESC`).bind(channelId).all();
  return json({ ok: true, data: rs.results || [] });
});

chat.post("/threads", zValidator("json", threadCreateSchema), async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  const body = await c.req.json();
  const acc = await channelAccess(c.env.DB, body.channel_id, user);
  if (!acc.found) return jsonError(Errors.notFound("Channel not found"));
  if (!acc.ok) return jsonError(Errors.forbidden("Not allowed in this channel"));
  const id = randomId("thr");
  await c.env.DB.prepare(`INSERT INTO threads (id, channel_id, title, author_id, pinned, locked, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0, ?, ?)`)
    .bind(id, body.channel_id, body.title, user.id, nowIso(), nowIso()).run();
  await logAnalytics(c.env.DB, "thread_created", user.id, { channel_id: body.channel_id });
  return json({ ok: true, data: { id, title: body.title } }, 201);
});

chat.patch("/threads/:id", async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  if (user.role !== "admin" && user.role !== "moderator") return jsonError(Errors.forbidden());
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const sets: string[] = []; const params: unknown[] = [];
  if ("pinned" in body) { sets.push("pinned = ?"); params.push(body.pinned ? 1 : 0); }
  if ("locked" in body) { sets.push("locked = ?"); params.push(body.locked ? 1 : 0); }
  if (sets.length === 0) return jsonError(Errors.badRequest("Nothing to update"));
  params.push(id);
  await c.env.DB.prepare(`UPDATE threads SET ${sets.join(", ")} WHERE id = ?`).bind(...(params as never[])).run();
  await logAudit(c.env.DB, { actorId: user.id, action: "thread_moderated", targetType: "thread", targetId: id, meta: body });
  return json({ ok: true });
});

// Delete a thread (and its messages, via ON DELETE CASCADE).
// Author of the thread may delete their own; admins/moderators may delete any.
chat.delete("/threads/:id", async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(`SELECT id, author_id FROM threads WHERE id = ?`).bind(id).first();
  if (!row) return jsonError(Errors.notFound("Thread not found"));
  const t = row as any;
  const isOwner = t.author_id && t.author_id === user.id;
  const isMod = user.role === "admin" || user.role === "moderator";
  if (!isOwner && !isMod) return jsonError(Errors.forbidden("You can only delete your own threads"));
  await c.env.DB.prepare(`DELETE FROM threads WHERE id = ?`).bind(id).run();
  await logAudit(c.env.DB, { actorId: user.id, action: "thread_deleted", targetType: "thread", targetId: id });
  return json({ ok: true });
});

// ── Messages (threaded replies) ──────────────────────────────────────────
chat.get("/messages", async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  const threadId = new URL(c.req.url).searchParams.get("thread_id");
  if (!threadId) return jsonError(Errors.badRequest("thread_id required"));
  const acc = await threadAccess(c.env.DB, threadId, user);
  if (!acc.found) return jsonError(Errors.notFound("Thread not found"));
  if (!acc.ok) return jsonError(Errors.forbidden("Not allowed in this channel"));
  const rs = await c.env.DB.prepare(
    `SELECT m.*, u.display_name as author_name, u.role as author_role
     FROM messages m LEFT JOIN users u ON u.id = m.author_id
     WHERE m.thread_id = ? AND m.deleted_at IS NULL ORDER BY m.created_at ASC`
  ).bind(threadId).all();
  const msgs = ((rs.results as any[]) || []).map((m) => ({ ...m, mentions: jsonField(m.mentions_json, []) }));
  return json({ ok: true, data: msgs });
});

chat.post("/messages", zValidator("json", messageCreateSchema), async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  const body = await c.req.json();
  const acc = await threadAccess(c.env.DB, body.thread_id, user);
  if (!acc.found) return jsonError(Errors.notFound("Thread not found"));
  if (!acc.ok) return jsonError(Errors.forbidden("Not allowed in this channel"));
  const t = acc.thread as any;
  if (t.locked) return jsonError(Errors.forbidden("Thread is locked"));
  if (body.parent_id) {
    const parent = await c.env.DB.prepare(`SELECT id FROM messages WHERE id = ? AND thread_id = ?`).bind(body.parent_id, body.thread_id).first();
    if (!parent) return jsonError(Errors.badRequest("Invalid parent message"));
  }
  const id = randomId("msg");
  await c.env.DB.prepare(
    `INSERT INTO messages (id, thread_id, parent_id, author_id, body, mentions_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, body.thread_id, body.parent_id ?? null, user.id, body.body, toJson(body.mentions || []), nowIso(), nowIso()).run();
  // bump thread updated_at
  await c.env.DB.prepare(`UPDATE threads SET updated_at = ? WHERE id = ?`).bind(nowIso(), body.thread_id).run();
  await logAnalytics(c.env.DB, "message_created", user.id, { thread_id: body.thread_id, mentions: (body.mentions || []).length });
  return json({ ok: true, data: { id, thread_id: body.thread_id } }, 201);
});

chat.patch("/messages/:id", async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  const id = c.req.param("id");
  const msg = await c.env.DB.prepare(`SELECT * FROM messages WHERE id = ?`).bind(id).first();
  if (!msg) return jsonError(Errors.notFound("Message not found"));
  const m = msg as any;
  if (m.author_id !== user.id && user.role !== "admin" && user.role !== "moderator") {
    return jsonError(Errors.forbidden("Cannot edit this message"));
  }
  const body = await c.req.json().catch(() => ({}));
  if (!body.body || typeof body.body !== "string") return jsonError(Errors.badRequest("body required"));
  await c.env.DB.prepare(`UPDATE messages SET body = ?, edited_at = ?, updated_at = ? WHERE id = ?`)
    .bind(body.body, nowIso(), nowIso(), id).run();
  return json({ ok: true });
});

chat.delete("/messages/:id", async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  const id = c.req.param("id");
  const msg = await c.env.DB.prepare(`SELECT * FROM messages WHERE id = ?`).bind(id).first();
  if (!msg) return jsonError(Errors.notFound("Message not found"));
  const m = msg as any;
  if (m.author_id !== user.id && user.role !== "admin" && user.role !== "moderator") {
    return jsonError(Errors.forbidden("Cannot delete this message"));
  }
  // soft delete
  await c.env.DB.prepare(`UPDATE messages SET deleted_at = ?, body = '[deleted]', updated_at = ? WHERE id = ?`)
    .bind(nowIso(), nowIso(), id).run();
  await logAudit(c.env.DB, { actorId: user.id, action: "message_deleted", targetType: "message", targetId: id });
  return json({ ok: true });
});

// ── Channel membership management (moderator+) ────────────────────────────
// Grant/revoke a specific user's access to a (private) channel without changing
// their global role. Every change is audited. Reads require canManageChannel.
chat.get("/channels/:id/members", async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  if (!canManageChannel(user)) return jsonError(Errors.forbidden());
  const channelId = c.req.param("id");
  const ch = await c.env.DB.prepare(`SELECT id FROM channels WHERE id = ?`).bind(channelId).first();
  if (!ch) return jsonError(Errors.notFound("Channel not found"));
  const members = await listChannelMembers(c.env.DB, channelId);
  return json({ ok: true, data: members.map((m) => ({ ...m, password_hash: undefined })) });
});

chat.post("/channels/:id/members", async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  if (!canManageChannel(user)) return jsonError(Errors.forbidden());
  const channelId = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  if (!body.user_id || typeof body.user_id !== "string") return jsonError(Errors.badRequest("user_id required"));
  const ch = await c.env.DB.prepare(`SELECT id FROM channels WHERE id = ?`).bind(channelId).first();
  if (!ch) return jsonError(Errors.notFound("Channel not found"));
  const target = await c.env.DB.prepare(`SELECT id FROM users WHERE id = ?`).bind(body.user_id).first();
  if (!target) return jsonError(Errors.notFound("User not found"));
  await addChannelMember(c.env.DB, channelId, body.user_id, user.id);
  await logAudit(c.env.DB, { actorId: user.id, action: "channel_member_added", targetType: "channel", targetId: channelId, meta: { user_id: body.user_id } });
  return json({ ok: true }, 201);
});

chat.delete("/channels/:id/members/:userId", async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  if (!canManageChannel(user)) return jsonError(Errors.forbidden());
  const channelId = c.req.param("id");
  const targetId = c.req.param("userId");
  await removeChannelMember(c.env.DB, channelId, targetId);
  await logAudit(c.env.DB, { actorId: user.id, action: "channel_member_removed", targetType: "channel", targetId: channelId, meta: { user_id: targetId } });
  return json({ ok: true });
});

export default chat;