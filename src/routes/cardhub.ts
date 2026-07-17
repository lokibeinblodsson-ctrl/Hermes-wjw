// Card hub routes: threaded comments, sources/citations (APA), and card
// relationships (related cards + related posts/pages). Co-located under
// /api/v1/board so it shares the board auth + helpers. Card-scoped activity
// is served from board.ts (/board/cards/:id/activity) reusing audit_logs.
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { Env } from "../lib/env";
import { json, jsonError, Errors } from "../lib/errors";
import { randomId, nowIso } from "../lib/crypto";
import { logAudit } from "../db/logging";

const cardhub = new Hono<{ Bindings: Env }>();
type D1DatabaseLike = import("@cloudflare/workers-types").D1Database;

async function me(db: D1DatabaseLike, c: any) {
  const auth = c.req.raw.headers.get("authorization");
  if (!auth) return null;
  try {
    const { verifyJwt } = await import("../lib/jwt");
    const p = await verifyJwt(auth.replace(/^Bearer /, ""));
    const r = await db.prepare(`SELECT id, display_name, role FROM users WHERE id = ?`).bind(p.sub).first();
    return (r as { id: string; display_name: string; role: string }) || null;
  } catch {
    return null;
  }
}

function requireUser(u: any) {
  if (!u) throw Errors.unauthorized();
  return u;
}

// Build a tidy APA citation from structured fields. Falls back to a raw string.
export function buildApa(s: {
  authors?: string; year?: string | null; title?: string; publisher?: string;
  url?: string | null; retrieved_date?: string | null;
}): string {
  if (!s.title && !s.authors) return "";
  const authors = s.authors?.trim() ? `${s.authors.trim()}. ` : "";
  const year = s.year?.trim() ? `(${s.year.trim()}). ` : "(n.d.). ";
  const title = s.title?.trim() ? `${s.title.trim()}. ` : "";
  const publisher = s.publisher?.trim() ? `${s.publisher.trim()}. ` : "";
  let tail = "";
  if (s.url?.trim()) {
    if (s.retrieved_date?.trim()) tail = `Retrieved ${s.retrieved_date.trim()} from ${s.url.trim()}`;
    else tail = s.url.trim();
  }
  return `${authors}${year}${title}${publisher}${tail}`.trim();
}

// ── Comments (threaded) ────────────────────────────────────────────────────
const commentSchema = z.object({
  body: z.string().min(1).max(5000),
  parent_id: z.string().max(64).optional().nullable(),
});

cardhub.get("/cards/:id/comments", async (c) => {
  requireUser(await me(c.env.DB, c));
  const cardId = c.req.param("id");
  const rs = await c.env.DB.prepare(
    `SELECT * FROM card_comments WHERE card_id = ? AND deleted_at IS NULL ORDER BY created_at ASC`
  ).bind(cardId).all();
  return json({ ok: true, data: rs.results || [] });
});

cardhub.post("/cards/:id/comments", zValidator("json", commentSchema), async (c) => {
  const u = requireUser(await me(c.env.DB, c));
  const cardId = c.req.param("id");
  const b = await c.req.json().catch(() => ({}));
  if (b.parent_id) {
    const parent = await c.env.DB.prepare(`SELECT id FROM card_comments WHERE id = ? AND card_id = ?`).bind(b.parent_id, cardId).first();
    if (!parent) return jsonError(Errors.badRequest("Parent comment not found on this card"));
  }
  const id = randomId("cmt");
  const now = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO card_comments (id, card_id, parent_id, author_id, author_name, body, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, cardId, b.parent_id || null, u.id, u.display_name, b.body, now, now).run();
  await logAudit(c.env.DB, { actorId: u.id, action: "card_comment_added", targetType: "card", targetId: cardId, meta: { comment_id: id } });
  const row = await c.env.DB.prepare(`SELECT * FROM card_comments WHERE id = ?`).bind(id).first();
  return json({ ok: true, data: row }, 201);
});

cardhub.patch("/cards/:id/comments/:cid", async (c) => {
  const u = requireUser(await me(c.env.DB, c));
  const cardId = c.req.param("id");
  const cid = c.req.param("cid");
  const b = await c.req.json().catch(() => ({}));
  const existing = await c.env.DB.prepare(`SELECT * FROM card_comments WHERE id = ? AND card_id = ?`).bind(cid, cardId).first();
  if (!existing) return jsonError(Errors.notFound("Comment not found"));
  if ((existing as any).author_id !== u.id && u.role !== "admin" && u.role !== "moderator")
    return jsonError(Errors.forbidden());
  const body = b.body ?? (existing as any).body;
  await c.env.DB.prepare(`UPDATE card_comments SET body = ?, updated_at = ? WHERE id = ?`)
    .bind(body, nowIso(), cid).run();
  const row = await c.env.DB.prepare(`SELECT * FROM card_comments WHERE id = ?`).bind(cid).first();
  return json({ ok: true, data: row });
});

cardhub.delete("/cards/:id/comments/:cid", async (c) => {
  const u = requireUser(await me(c.env.DB, c));
  const cardId = c.req.param("id");
  const cid = c.req.param("cid");
  const existing = await c.env.DB.prepare(`SELECT * FROM card_comments WHERE id = ? AND card_id = ?`).bind(cid, cardId).first();
  if (!existing) return jsonError(Errors.notFound("Comment not found"));
  if ((existing as any).author_id !== u.id && u.role !== "admin" && u.role !== "moderator")
    return jsonError(Errors.forbidden());
  // Soft delete keeps history for audit/traceability.
  await c.env.DB.prepare(`UPDATE card_comments SET deleted_at = ?, body = '[deleted]', updated_at = ? WHERE id = ?`)
    .bind(nowIso(), nowIso(), cid).run();
  await logAudit(c.env.DB, { actorId: u.id, action: "card_comment_deleted", targetType: "card", targetId: cardId, meta: { comment_id: cid } });
  return json({ ok: true });
});

// ── Sources / citations ─────────────────────────────────────────────────────
const sourceSchema = z.object({
  source_type: z.enum(["website", "article", "book", "scholarly", "reference"]).optional().default("website"),
  authors: z.string().max(500).optional().default(""),
  year: z.string().max(16).optional().nullable(),
  title: z.string().max(600).optional().default(""),
  publisher: z.string().max(400).optional().default(""),
  url: z.string().max(4000).optional().nullable(),
  retrieved_date: z.string().max(40).optional().nullable(),
  citation: z.string().max(4000).optional().default(""),
  note: z.string().max(2000).optional().default(""),
});

cardhub.get("/cards/:id/sources", async (c) => {
  requireUser(await me(c.env.DB, c));
  const cardId = c.req.param("id");
  const rs = await c.env.DB.prepare(`SELECT * FROM card_sources WHERE card_id = ? ORDER BY created_at ASC`).bind(cardId).all();
  return json({ ok: true, data: rs.results || [] });
});

cardhub.post("/cards/:id/sources", zValidator("json", sourceSchema), async (c) => {
  const u = requireUser(await me(c.env.DB, c));
  const cardId = c.req.param("id");
  const b = await c.req.json();
  const citation = b.citation?.trim() || buildApa(b);
  const id = randomId("src");
  const now = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO card_sources (id, card_id, source_type, authors, year, title, publisher, url, retrieved_date, citation, note, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, cardId, b.source_type, b.authors || "", b.year || null, b.title || "", b.publisher || "",
    b.url || null, b.retrieved_date || null, citation, b.note || "", u.id, now, now).run();
  await logAudit(c.env.DB, { actorId: u.id, action: "card_source_added", targetType: "card", targetId: cardId, meta: { source_id: id } });
  const row = await c.env.DB.prepare(`SELECT * FROM card_sources WHERE id = ?`).bind(id).first();
  return json({ ok: true, data: row }, 201);
});

cardhub.patch("/cards/:id/sources/:sid", zValidator("json", sourceSchema.partial()), async (c) => {
  requireUser(await me(c.env.DB, c));
  const cardId = c.req.param("id");
  const sid = c.req.param("sid");
  const existing = await c.env.DB.prepare(`SELECT * FROM card_sources WHERE id = ? AND card_id = ?`).bind(sid, cardId).first();
  if (!existing) return jsonError(Errors.notFound("Source not found"));
  const b = await c.req.json();
  const sets: string[] = []; const params: unknown[] = [];
  for (const f of ["source_type", "authors", "year", "title", "publisher", "url", "retrieved_date", "note"]) {
    if (f in b && b[f] !== undefined) { sets.push(`${f} = ?`); params.push(b[f]); }
  }
  // Rebuild citation when structured fields change and no explicit citation given.
  const structuredChanged = ["authors", "year", "title", "publisher", "url", "retrieved_date"].some((f) => f in b);
  let citation = (existing as any).citation;
  if (b.citation !== undefined) citation = b.citation;
  else if (structuredChanged) citation = buildApa({ ...(existing as any), ...b });
  sets.push("citation = ?"); params.push(citation);
  sets.push("updated_at = ?"); params.push(nowIso()); params.push(sid);
  await c.env.DB.prepare(`UPDATE card_sources SET ${sets.join(", ")} WHERE id = ?`).bind(...(params as never[])).run();
  const row = await c.env.DB.prepare(`SELECT * FROM card_sources WHERE id = ?`).bind(sid).first();
  return json({ ok: true, data: row });
});

cardhub.delete("/cards/:id/sources/:sid", async (c) => {
  const u = requireUser(await me(c.env.DB, c));
  const cardId = c.req.param("id");
  const sid = c.req.param("sid");
  const existing = await c.env.DB.prepare(`SELECT * FROM card_sources WHERE id = ? AND card_id = ?`).bind(sid, cardId).first();
  if (!existing) return jsonError(Errors.notFound("Source not found"));
  await c.env.DB.prepare(`DELETE FROM card_sources WHERE id = ?`).bind(sid).run();
  await logAudit(c.env.DB, { actorId: u.id, action: "card_source_deleted", targetType: "card", targetId: cardId, meta: { source_id: sid } });
  return json({ ok: true });
});

// ── Relationships / related content ─────────────────────────────────────────
const linkSchema = z.object({
  link_type: z.enum(["related_card", "related_post"]).optional().default("related_card"),
  target_card_id: z.string().max(64).optional().nullable(),
  target_title: z.string().max(400).optional().default(""),
  target_url: z.string().max(4000).optional().nullable(),
  note: z.string().max(2000).optional().default(""),
});

cardhub.get("/cards/:id/links", async (c) => {
  requireUser(await me(c.env.DB, c));
  const cardId = c.req.param("id");
  const rs = await c.env.DB.prepare(`SELECT * FROM card_links WHERE card_id = ? ORDER BY link_type, created_at ASC`).bind(cardId).all();
  return json({ ok: true, data: rs.results || [] });
});

cardhub.post("/cards/:id/links", zValidator("json", linkSchema), async (c) => {
  const u = requireUser(await me(c.env.DB, c));
  const cardId = c.req.param("id");
  const b = await c.req.json();
  if (b.link_type === "related_card") {
    if (!b.target_card_id) return jsonError(Errors.badRequest("target_card_id required for related_card"));
    const tgt = await c.env.DB.prepare(`SELECT id, title FROM cards WHERE id = ?`).bind(b.target_card_id).first();
    if (!tgt) return jsonError(Errors.notFound("Target card not found"));
    b.target_title = (tgt as any).title;
  } else {
    if (!b.target_title?.trim()) return jsonError(Errors.badRequest("target_title required for related_post"));
  }
  const id = randomId("lnk");
  const now = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO card_links (id, card_id, link_type, target_card_id, target_title, target_url, note, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, cardId, b.link_type, b.target_card_id || null, b.target_title || "", b.target_url || null, b.note || "", u.id, now, now).run();
  await logAudit(c.env.DB, { actorId: u.id, action: "card_link_added", targetType: "card", targetId: cardId, meta: { link_id: id, link_type: b.link_type } });
  const row = await c.env.DB.prepare(`SELECT * FROM card_links WHERE id = ?`).bind(id).first();
  return json({ ok: true, data: row }, 201);
});

cardhub.delete("/cards/:id/links/:lid", async (c) => {
  const u = requireUser(await me(c.env.DB, c));
  const cardId = c.req.param("id");
  const lid = c.req.param("lid");
  const existing = await c.env.DB.prepare(`SELECT * FROM card_links WHERE id = ? AND card_id = ?`).bind(lid, cardId).first();
  if (!existing) return jsonError(Errors.notFound("Link not found"));
  await c.env.DB.prepare(`DELETE FROM card_links WHERE id = ?`).bind(lid).run();
  await logAudit(c.env.DB, { actorId: u.id, action: "card_link_deleted", targetType: "card", targetId: cardId, meta: { link_id: lid } });
  return json({ ok: true });
});

export default cardhub;
