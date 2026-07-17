// Publishing pipeline: content drafts flow draft → in_review → approved →
// published. Reviewers (and above) can approve/reject; only then can an item be
// published, which generates + stores a hero image and records a public URL.
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { Env } from "../lib/env";
import { json, jsonError, Errors } from "../lib/errors";
import { requireRole, canReview, ROLE_RANK } from "../lib/auth";
import { resolveSession } from "../db/users";
import { randomId, nowIso } from "../lib/crypto";
import { generateImage } from "../lib/imageGen";
import { storeImage, activeBackend } from "../lib/storage";
import { logAudit } from "../db/logging";

const publishing = new Hono<{ Bindings: Env }>();
type D1DatabaseLike = import("@cloudflare/workers-types").D1Database;

const contentCreateSchema = z.object({
  title: z.string().min(1).max(300),
  body: z.string().max(20000).optional().default(""),
  image_prompt: z.string().max(2000).optional().default(""),
});
const reviewSchema = z.object({
  action: z.enum(["approve", "reject"]),
  note: z.string().max(2000).optional().default(""),
});

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

async function contentAuthor(db: D1DatabaseLike, id: string): Promise<string | null> {
  const r = await db.prepare(`SELECT created_by FROM content_items WHERE id = ?`).bind(id).first();
  return r ? (r as { created_by: string }).created_by : null;
}

// ── List / create ────────────────────────────────────────────────────────────
publishing.get("/", async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  const rs = await c.env.DB.prepare(`SELECT * FROM content_items ORDER BY updated_at DESC LIMIT 100`).all();
  return json({ ok: true, data: rs.results || [] });
});

publishing.post("/", zValidator("json", contentCreateSchema), async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  const body = await c.req.json();
  const id = randomId("cnt");
  await c.env.DB.prepare(
    `INSERT INTO content_items (id, title, body, image_prompt, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)`
  ).bind(id, body.title, body.body || "", body.image_prompt || "", user.id, nowIso(), nowIso()).run();
  await logAudit(c.env.DB, { actorId: user.id, action: "content_created", targetType: "content", targetId: id });
  return json({ ok: true, data: { id } }, 201);
});

// Submit a draft for review.
publishing.post("/:id/submit", async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  const id = c.req.param("id");
  const author = await contentAuthor(c.env.DB, id);
  if (author !== user.id && ROLE_RANK[user.role] < ROLE_RANK.moderator) {
    return jsonError(Errors.forbidden("Only the author or a moderator+ can submit"));
  }
  await c.env.DB.prepare(`UPDATE content_items SET status='in_review', updated_at=? WHERE id=?`).bind(nowIso(), id).run();
  await c.env.DB.prepare(
    `INSERT INTO publish_events (id, content_id, actor_id, action, created_at) VALUES (?,?,?, 'submitted', ?)`
  ).bind(randomId("pe"), id, user.id, nowIso()).run();
  return json({ ok: true });
});

// Reviewer decision. Reviewers (and above) may approve/reject.
publishing.post("/:id/review", zValidator("json", reviewSchema), async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  if (!canReview(user)) return jsonError(Errors.forbidden("Reviewer permission required"));
  const id = c.req.param("id");
  const body = await c.req.json();
  const status = body.action === "reject" ? "rejected" : "approved";
  await c.env.DB.prepare(
    `UPDATE content_items SET status=?, reviewer_id=?, reviewer_note=?, updated_at=? WHERE id=?`
  ).bind(status, user.id, body.note || "", nowIso(), id).run();
  await c.env.DB.prepare(
    `INSERT INTO publish_events (id, content_id, actor_id, action, note, created_at) VALUES (?,?,?,?,?,?)`
  ).bind(randomId("pe"), id, user.id, body.action === "reject" ? "rejected" : "approved", body.note || "", nowIso()).run();
  await logAudit(c.env.DB, { actorId: user.id, action: `content_${status}`, targetType: "content", targetId: id });
  return json({ ok: true });
});

// Publish an approved item: generate + store image, record public URL.
publishing.post("/:id/publish", async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  if (ROLE_RANK[user.role] < ROLE_RANK.moderator) {
    return jsonError(Errors.forbidden("Moderator+ required to publish"));
  }
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(`SELECT * FROM content_items WHERE id=?`).bind(id).first();
  if (!row) return jsonError(Errors.notFound());
  const r = row as { status: string; image_prompt: string; image_url: string | null };
  if (r.status !== "approved") {
    return jsonError(Errors.badRequest("Only approved content can be published"));
  }
  let imageUrl = r.image_url;
  if (r.image_prompt && !imageUrl) {
    const gen = await generateImage(c.env, r.image_prompt);
    if (gen) {
      const stored = await storeImage(c.env as any, gen.bytes, gen.contentType, `posts/${id}.png`);
      imageUrl = stored.url;
    }
  }
  await c.env.DB.prepare(`UPDATE content_items SET status='published', image_url=?, updated_at=? WHERE id=?`)
    .bind(imageUrl, nowIso(), id).run();
  await c.env.DB.prepare(
    `INSERT INTO publish_events (id, content_id, actor_id, action, created_at) VALUES (?,?,?, 'published', ?)`
  ).bind(randomId("pe"), id, user.id, nowIso()).run();
  await logAudit(c.env.DB, {
    actorId: user.id, action: "content_published", targetType: "content", targetId: id,
    meta: { backend: activeBackend(c.env as any), image_url: imageUrl },
  });
  return json({ ok: true, data: { status: "published", image_url: imageUrl } });
});

export default publishing;
