// Content calendar routes: month view + scheduling. Entries come from two
// sources merged together:
//   1. cards with a non-null scheduled_date (the primary scheduling surface on
//      the board / card workspace)
//   2. calendar_items (richer dated plans: content_items, external posts)
// Both are read through /calendar/month?year=&month= and the board's
// scheduled cards are exposed via /calendar/cards.
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { Env } from "../lib/env";
import { json, jsonError, Errors } from "../lib/errors";
import { resolveSession } from "../db/users";
import { randomId, nowIso, jsonField } from "../lib/crypto";
import { logAudit } from "../db/logging";

const calendar = new Hono<{ Bindings: Env }>();
type D1DatabaseLike = import("@cloudflare/workers-types").D1Database;

async function me(db: D1DatabaseLike, c: any) {
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

// Month view: year + month (1-12). Returns events grouped by YYYY-MM-DD.
calendar.get("/month", async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  const url = new URL(c.req.url);
  const now = new Date();
  const year = parseInt(url.searchParams.get("year") || `${now.getFullYear()}`);
  const month = parseInt(url.searchParams.get("month") || `${now.getMonth() + 1}`);
  const ym = `${year}-${String(month).padStart(2, "0")}`;

  // 1) Card-level scheduled dates in this month.
  const cardRs = await c.env.DB.prepare(
    `SELECT c.id, c.title, c.scheduled_date, c.priority, c.platforms, cat.name as category_name, cat.color as category_color
     FROM cards c LEFT JOIN categories cat ON cat.id = c.category_id
     WHERE c.scheduled_date IS NOT NULL AND c.scheduled_date <> '' AND c.scheduled_date LIKE ?`
  ).bind(`${ym}%`).all();
  const byDate = new Map<string, any[]>();
  for (const r of (cardRs.results as any[]) || []) {
    byDate.set(r.scheduled_date, [...(byDate.get(r.scheduled_date) || []), {
      id: r.id, kind: "card", title: r.title, status: "scheduled", priority: r.priority,
      platforms: jsonField(r.platforms, []), category_name: r.category_name, category_color: r.category_color,
    }]);
  }

  // 2) calendar_items in this month.
  const itemRs = await c.env.DB.prepare(`SELECT * FROM calendar_items WHERE date LIKE ? ORDER BY date ASC`).bind(`${ym}%`).all();
  for (const r of (itemRs.results as any[]) || []) {
    byDate.set(r.date, [...(byDate.get(r.date) || []), {
      id: r.id, kind: "item", title: r.title, status: r.status, platform: r.platform,
      note: r.note, card_id: r.card_id, content_id: r.content_id,
    }]);
  }

  return json({ ok: true, data: { year, month, events_by_date: Object.fromEntries(byDate) } });
});

// List all scheduled cards (for the board quick-chat / calendar linking).
calendar.get("/cards", async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  const rs = await c.env.DB.prepare(
    `SELECT c.id, c.title, c.scheduled_date, c.priority, cat.name as category_name
     FROM cards c LEFT JOIN categories cat ON cat.id = c.category_id
     WHERE c.scheduled_date IS NOT NULL AND c.scheduled_date <> ''
     ORDER BY c.scheduled_date ASC`
  ).all();
  return json({ ok: true, data: rs.results || [] });
});

// Set/unset a card's scheduled date from the calendar (staff or card owner).
calendar.post("/cards/:id/schedule", zValidator("json", z.object({ scheduled_date: z.string().nullable() })), async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const card = await c.env.DB.prepare(`SELECT id, created_by FROM cards WHERE id = ?`).bind(id).first();
  if (!card) return jsonError(Errors.notFound("Card not found"));
  const cr = card as { created_by: string | null };
  if (user.role !== "admin" && user.role !== "moderator" && cr.created_by !== user.id) {
    return jsonError(Errors.forbidden("Not allowed to schedule this card"));
  }
  await c.env.DB.prepare(`UPDATE cards SET scheduled_date = ?, updated_at = ? WHERE id = ?`).bind(body.scheduled_date || null, nowIso(), id).run();
  await logAudit(c.env.DB, { actorId: user.id, action: "card_scheduled", targetType: "card", targetId: id, meta: { scheduled_date: body.scheduled_date || null } });
  const updated = await c.env.DB.prepare(`SELECT id, scheduled_date FROM cards WHERE id = ?`).bind(id).first();
  return json({ ok: true, data: updated });
});

// calendar_items CRUD (richer scheduled plans; content/publication items).
const itemSchema = z.object({
  title: z.string().min(1).max(300),
  date: z.string().min(1).max(20),
  status: z.enum(["scheduled", "draft", "in_review", "approved", "published", "done"]).optional().default("scheduled"),
  platform: z.string().max(50).nullable().optional(),
  card_id: z.string().max(120).nullable().optional(),
  content_id: z.string().max(120).nullable().optional(),
  note: z.string().max(2000).optional().default(""),
});
const itemUpdateSchema = itemSchema.partial();

calendar.post("/", zValidator("json", itemSchema), async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  const b = await c.req.json();
  const id = randomId("cal");
  await c.env.DB.prepare(
    `INSERT INTO calendar_items (id, title, date, status, platform, card_id, content_id, note, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, b.title, b.date, b.status || "scheduled", b.platform || null, b.card_id || null, b.content_id || null, b.note || "", user.id, nowIso(), nowIso()).run();
  await logAudit(c.env.DB, { actorId: user.id, action: "calendar_item_created", targetType: "calendar_item", targetId: id });
  const created = await c.env.DB.prepare(`SELECT * FROM calendar_items WHERE id = ?`).bind(id).first();
  return json({ ok: true, data: serializeItem(created) }, 201);
});

calendar.patch("/:id", zValidator("json", itemUpdateSchema), async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare(`SELECT * FROM calendar_items WHERE id = ?`).bind(id).first();
  if (!existing) return jsonError(Errors.notFound("Calendar item not found"));
  const body = await c.req.json().catch(() => ({}));
  const sets: string[] = []; const params: unknown[] = [];
  for (const f of ["title", "date", "status", "platform", "card_id", "content_id", "note"]) {
    if (f in body && body[f] !== undefined) { sets.push(`${f} = ?`); params.push(body[f]); }
  }
  if (!sets.length) return jsonError(Errors.badRequest("Nothing to update"));
  sets.push("updated_at = ?"); params.push(nowIso()); params.push(id);
  await c.env.DB.prepare(`UPDATE calendar_items SET ${sets.join(", ")} WHERE id = ?`).bind(...(params as never[])).run();
  const updated = await c.env.DB.prepare(`SELECT * FROM calendar_items WHERE id = ?`).bind(id).first();
  return json({ ok: true, data: serializeItem(updated) });
});

calendar.delete("/:id", async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  if (user.role !== "admin" && user.role !== "moderator") return jsonError(Errors.forbidden());
  const id = c.req.param("id");
  await c.env.DB.prepare(`DELETE FROM calendar_items WHERE id = ?`).bind(id).run();
  return json({ ok: true });
});

function serializeItem(r: any) {
  if (!r) return r;
  return { ...r, tags: jsonField(r.tags_json, []) };
}

export default calendar;
