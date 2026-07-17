// Board (kanban) routes: columns, cards CRUD, categories, search/filter/sort,
// drag-and-drop reposition, audit logging of card changes.
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { Env } from "../lib/env";
import { json, jsonError, Errors } from "../lib/errors";
import {
  cardCreateSchema,
  cardUpdateSchema,
  categorySchema,
} from "../lib/validation";
import { randomId, nowIso, toJson, jsonField } from "../lib/crypto";
import { resolveSession } from "../db/users";
import { logAudit, logAnalytics } from "../db/logging";
import { requireAuth, isAdmin } from "../lib/auth";
import { ensureDefaults } from "../bootstrap";

const board = new Hono<{ Bindings: Env }>();

// Resolve current user helper (shared JWT extraction).
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
type D1DatabaseLike = import("@cloudflare/workers-types").D1Database;

// Serialize a raw cards row into the API card shape: parse JSON columns and
// coerce the platform_ready flag to a boolean. Safe against pre-0002 rows.
function serializeCard(r: any): any {
  if (!r) return r;
  return {
    ...r,
    tags: jsonField(r.tags_json, []),
    checklist: jsonField(r.checklist, []),
    media: jsonField(r.media, []),
    resources: jsonField(r.resources, []),
    custom_fields: jsonField(r.custom_fields, []),
    platforms: jsonField(r.platforms, []),
    platform_ready: !!r.platform_ready,
    scheduled_date: r.scheduled_date ?? null,
    draft: r.draft ?? null,
    notes: r.notes ?? null,
    content_pillar: r.content_pillar ?? null,
    research_page_id: r.research_page_id ?? null,
  };
}

// ── Columns ──────────────────────────────────────────────────────────────
board.get("/columns", async (c) => {
  await ensureDefaults(c.env.DB);
  const rs = await c.env.DB.prepare(`SELECT * FROM board_columns ORDER BY position ASC`).all();
  return json({ ok: true, data: rs.results || [] });
});

board.post("/columns", zValidator("json", categorySchema), async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  if (user.role !== "admin" && user.role !== "moderator") return jsonError(Errors.forbidden());
  const body = await c.req.json();
  const id = randomId("col");
  const pos = (rs0(await c.env.DB.prepare(`SELECT COALESCE(MAX(position),0)+1 as p FROM board_columns`).first()) as number) || 0;
  await c.env.DB.prepare(`INSERT INTO board_columns (id, name, position, color, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(id, body.name, pos, body.color, nowIso()).run();
  await logAudit(c.env.DB, { actorId: user.id, action: "board_column_created", targetType: "column", targetId: id });
  return json({ ok: true, data: { id, name: body.name, position: pos, color: body.color } }, 201);
});

// ── Cards ────────────────────────────────────────────────────────────────
board.get("/cards", async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  const url = new URL(c.req.url);
  const columnId = url.searchParams.get("column_id");
  const categoryId = url.searchParams.get("category_id");
  const priority = url.searchParams.get("priority");
  const assignee = url.searchParams.get("assignee_id");
  const tag = url.searchParams.get("tag");
  const q = url.searchParams.get("q");
  const sort = url.searchParams.get("sort") || "position";
  const where: string[] = [];
  const params: unknown[] = [];
  if (columnId) { where.push("c.column_id = ?"); params.push(columnId); }
  if (categoryId) { where.push("c.category_id = ?"); params.push(categoryId); }
  if (priority) { where.push("c.priority = ?"); params.push(priority); }
  if (assignee) { where.push("c.assignee_id = ?"); params.push(assignee); }
  if (tag) { where.push("json_extract(c.tags_json, '$') LIKE ?"); params.push(`%"${tag}"%`); }
  if (q) { where.push("(c.title LIKE ? OR c.description LIKE ?)"); params.push(`%${q}%`, `%${q}%`); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const orderSql = sort === "due_date" ? "ORDER BY c.due_date ASC" :
                   sort === "priority" ? "ORDER BY CASE c.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END" :
                   sort === "created_at" ? "ORDER BY c.created_at DESC" :
                   "ORDER BY c.position ASC";
  const sql = `SELECT c.*, u.display_name as assignee_name, cat.name as category_name
               FROM cards c
               LEFT JOIN users u ON u.id = c.assignee_id
               LEFT JOIN categories cat ON cat.id = c.category_id
               ${whereSql} ${orderSql}`;
  const rs = await c.env.DB.prepare(sql).bind(...(params as never[])).all();
  const cards = ((rs.results as any[]) || []).map(serializeCard);
  return json({ ok: true, data: cards });
});

board.post("/cards", zValidator("json", cardCreateSchema), async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  const body = await c.req.json();
  // validate column
  const col = await c.env.DB.prepare(`SELECT id FROM board_columns WHERE id = ?`).bind(body.column_id).first();
  if (!col) return jsonError(Errors.badRequest("Invalid column_id"));
  if (body.category_id) {
    const cat = await c.env.DB.prepare(`SELECT id FROM categories WHERE id = ?`).bind(body.category_id).first();
    if (!cat) return jsonError(Errors.badRequest("Invalid category_id"));
  }
  if (body.assignee_id) {
    const a = await c.env.DB.prepare(`SELECT id FROM users WHERE id = ?`).bind(body.assignee_id).first();
    if (!a) return jsonError(Errors.badRequest("Invalid assignee_id"));
  }
  const id = randomId("card");
  const pos = (rs0(await c.env.DB.prepare(`SELECT COALESCE(MAX(position),0)+1 as p FROM cards WHERE column_id = ?`).bind(body.column_id).first()) as number) || 0;
  await c.env.DB.prepare(
    `INSERT INTO cards (id, column_id, title, description, priority, due_date, category_id, tags_json, assignee_id, created_by, created_at, updated_at, position,
                        draft, checklist, media, resources, custom_fields, notes, content_pillar, platform_ready, platforms, research_page_id, scheduled_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, body.column_id, body.title, body.description || "", body.priority || "medium",
    body.due_date ?? null, body.category_id ?? null, toJson(body.tags || []),
    body.assignee_id ?? null, user.id, nowIso(), nowIso(), pos,
    body.draft ?? null, toJson(body.checklist || []), toJson(body.media || []),
    toJson(body.resources || []), toJson(body.custom_fields || []), body.notes ?? null,
    body.content_pillar ?? null, body.platform_ready ? 1 : 0, toJson(body.platforms || []),
    body.research_page_id ?? null, body.scheduled_date ?? null
  ).run();
  await logAudit(c.env.DB, { actorId: user.id, action: "card_created", targetType: "card", targetId: id, meta: { title: body.title, column_id: body.column_id } });
  await logAnalytics(c.env.DB, "card_created", user.id, { column_id: body.column_id });
  // fetch created card
  const created = await c.env.DB.prepare(`SELECT * FROM cards WHERE id = ?`).bind(id).first();
  return json({ ok: true, data: serializeCard(created) }, 201);
});

board.get("/cards/:id", async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  const id = c.req.param("id");
  const card = await c.env.DB.prepare(
    `SELECT c.*, u.display_name as assignee_name, cat.name as category_name
     FROM cards c LEFT JOIN users u ON u.id = c.assignee_id
     LEFT JOIN categories cat ON cat.id = c.category_id WHERE c.id = ?`
  ).bind(id).first();
  if (!card) return jsonError(Errors.notFound("Card not found"));
  return json({ ok: true, data: serializeCard(card) });
});

// Card-scoped activity: reuse audit_logs (no separate table). Returns recent
// audit events where target_type = 'card' and target_id = this card, plus any
// publishing events tied to content_items linked from this card's sources
// (kept simple: just audit for now; publishing events are surfaced per-item).
board.get("/cards/:id/activity", async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  const id = c.req.param("id");
  const limit = Math.min(100, parseInt(new URL(c.req.url).searchParams.get("limit") || "50") || 50);
  const rs = await c.env.DB.prepare(
    `SELECT * FROM audit_logs WHERE target_type = 'card' AND target_id = ? ORDER BY created_at DESC LIMIT ?`
  ).bind(id, limit).all();
  const rows = ((rs.results as any[]) || []).map((r) => ({ ...r, meta: jsonField(r.meta_json, {}) }));
  return json({ ok: true, data: rows });
});

board.patch("/cards/:id", zValidator("json", cardUpdateSchema), async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare(`SELECT * FROM cards WHERE id = ?`).bind(id).first();
  if (!existing) return jsonError(Errors.notFound("Card not found"));
  const body = await c.req.json();
  const sets: string[] = [];
  const params: unknown[] = [];
  const auditMeta: Record<string, unknown> = {};
  for (const f of ["column_id", "title", "description", "priority", "due_date", "category_id", "assignee_id", "position", "draft", "notes", "content_pillar", "research_page_id", "scheduled_date"]) {
    if (f in body && body[f] !== undefined) { sets.push(`${f} = ?`); params.push(body[f]); auditMeta[f] = body[f]; }
  }
  if ("tags" in body && body.tags !== undefined) { sets.push("tags_json = ?"); params.push(toJson(body.tags)); }
  for (const jf of ["checklist", "media", "resources", "custom_fields", "platforms"]) {
    if (jf in body && body[jf] !== undefined) { sets.push(`${jf} = ?`); params.push(toJson(body[jf])); }
  }
  if ("platform_ready" in body && body.platform_ready !== undefined) {
    sets.push("platform_ready = ?"); params.push(body.platform_ready ? 1 : 0); auditMeta.platform_ready = body.platform_ready;
  }
  if (sets.length === 0) return jsonError(Errors.badRequest("No fields to update"));
  sets.push("updated_at = ?"); params.push(nowIso());
  params.push(id);
  await c.env.DB.prepare(`UPDATE cards SET ${sets.join(", ")} WHERE id = ?`).bind(...(params as never[])).run();
  await logAudit(c.env.DB, { actorId: user.id, action: "card_updated", targetType: "card", targetId: id, meta: auditMeta });
  await logAnalytics(c.env.DB, "card_updated", user.id, { card_id: id });
  const updated = await c.env.DB.prepare(`SELECT * FROM cards WHERE id = ?`).bind(id).first();
  return json({ ok: true, data: serializeCard(updated) });
});

board.delete("/cards/:id", async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  if (user.role !== "admin" && user.role !== "moderator") return jsonError(Errors.forbidden());
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare(`SELECT id FROM cards WHERE id = ?`).bind(id).first();
  if (!existing) return jsonError(Errors.notFound("Card not found"));
  await c.env.DB.prepare(`DELETE FROM cards WHERE id = ?`).bind(id).run();
  await logAudit(c.env.DB, { actorId: user.id, action: "card_deleted", targetType: "card", targetId: id });
  await logAnalytics(c.env.DB, "card_deleted", user.id, { card_id: id });
  return json({ ok: true });
});

// ── Categories ───────────────────────────────────────────────────────────
board.get("/categories", async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  const rs = await c.env.DB.prepare(`SELECT * FROM categories ORDER BY position ASC, name ASC`).all();
  return json({ ok: true, data: rs.results || [] });
});

board.post("/categories", zValidator("json", categorySchema), async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  if (user.role !== "admin" && user.role !== "moderator") return jsonError(Errors.forbidden("Only staff can manage categories"));
  const body = await c.req.json();
  // prevent duplicate name
  const dup = await c.env.DB.prepare(`SELECT id FROM categories WHERE lower(name) = lower(?)`).bind(body.name).first();
  if (dup) return jsonError(Errors.conflict("A category with this name already exists"));
  const id = randomId("cat");
  const pos = (rs0(await c.env.DB.prepare(`SELECT COALESCE(MAX(position),0)+1 as p FROM categories`).first()) as number) || 0;
  await c.env.DB.prepare(`INSERT INTO categories (id, name, description, color, position, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, body.name, body.description || "", body.color, pos, user.id, nowIso(), nowIso()).run();
  await logAudit(c.env.DB, { actorId: user.id, action: "category_created", targetType: "category", targetId: id });
  return json({ ok: true, data: { id, name: body.name, color: body.color, position: pos } }, 201);
});

board.patch("/categories/:id", zValidator("json", categorySchema.partial()), async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  if (user.role !== "admin" && user.role !== "moderator") return jsonError(Errors.forbidden());
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare(`SELECT id FROM categories WHERE id = ?`).bind(id).first();
  if (!existing) return jsonError(Errors.notFound("Category not found"));
  const body = await c.req.json();
  const sets: string[] = []; const params: unknown[] = [];
  for (const f of ["name", "description", "color"]) {
    if (f in body && body[f] !== undefined) { sets.push(`${f} = ?`); params.push(body[f]); }
  }
  if (sets.length === 0) return jsonError(Errors.badRequest("No fields to update"));
  sets.push("updated_at = ?"); params.push(nowIso());
  params.push(id);
  await c.env.DB.prepare(`UPDATE categories SET ${sets.join(", ")} WHERE id = ?`).bind(...(params as never[])).run();
  await logAudit(c.env.DB, { actorId: user.id, action: "category_updated", targetType: "category", targetId: id });
  return json({ ok: true });
});

board.delete("/categories/:id", async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  if (user.role !== "admin" && user.role !== "moderator") return jsonError(Errors.forbidden());
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare(`SELECT id FROM categories WHERE id = ?`).bind(id).first();
  if (!existing) return jsonError(Errors.notFound("Category not found"));
  // Safety: reassign cards to NULL (prevent broken references), then delete.
  await c.env.DB.prepare(`UPDATE cards SET category_id = NULL WHERE category_id = ?`).bind(id).run();
  await c.env.DB.prepare(`DELETE FROM categories WHERE id = ?`).bind(id).run();
  await logAudit(c.env.DB, { actorId: user.id, action: "category_deleted", targetType: "category", targetId: id, meta: { reassigned_cards: true } });
  return json({ ok: true });
});

// Reorder categories (expects ordered array of ids). Staff only.
board.post("/categories/reorder", async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  if (user.role !== "admin" && user.role !== "moderator") return jsonError(Errors.forbidden());
  const { ids } = await c.req.json().catch(() => ({ ids: [] }));
  if (!Array.isArray(ids)) return jsonError(Errors.badRequest("ids array required"));
  for (let i = 0; i < ids.length; i++) {
    await c.env.DB.prepare(`UPDATE categories SET position = ? WHERE id = ?`).bind(i, ids[i]).run();
  }
  await logAudit(c.env.DB, { actorId: user.id, action: "category_reordered" });
  return json({ ok: true });
});

function rs0(r: unknown): unknown {
  if (!r) return 0;
  const rr = r as { p?: number };
  return rr.p ?? 0;
}

export default board;
