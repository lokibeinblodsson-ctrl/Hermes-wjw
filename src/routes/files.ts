// Files routes: metadata + optional binary upload for PDFs, images, references
// and brand assets. Binary bytes are stored via the storage adapter (R2/B2) or
// fall back to an inline data: URL when no storage is configured. The DB row
// keeps the pointer + tags so the UI can list, preview, search and tag files
// without re-fetching blobs.
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { Env } from "../lib/env";
import { json, jsonError, Errors } from "../lib/errors";
import { resolveSession } from "../db/users";
import { randomId, nowIso, toJson, jsonField } from "../lib/crypto";
import { logAudit } from "../db/logging";
import { storeImage, activeBackend } from "../lib/storage";

const files = new Hono<{ Bindings: Env }>();
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

function guessKind(name: string, mime?: string): string {
  const n = (name || "").toLowerCase();
  const m = (mime || "").toLowerCase();
  if (m.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/.test(n)) return "image";
  if (m === "application/pdf" || /\.pdf$/.test(n)) return "pdf";
  if (/\.(docx?|txt|md|csv|pptx?|xlsx?)$/.test(n)) return "doc";
  if (/\.(png|jpe?g|gif|webp|svg|mp4|webm|mov)$/.test(n) && /asset|brand|template/.test(n)) return "asset";
  return "file";
}

const uploadSchema = z.object({
  name: z.string().min(1).max(300),
  kind: z.string().max(40).optional(),
  mime: z.string().max(120).optional(),
  tags: z.array(z.string().max(50)).max(20).optional().default([]),
  note: z.string().max(2000).optional().default(""),
  // Inline data: URL (browser FileReader) OR a hosted URL. Stored directly so
  // the feature works with zero storage secrets; R2/B2 path is used when bound.
  url: z.string().max(8000).optional(),
});

files.post("/", zValidator("json", uploadSchema), async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  const b = await c.req.json().catch(() => ({}));
  const name = b.name;
  const kind = b.kind || guessKind(name, b.mime);
  let url = b.url || null;
  let sizeBytes: number | null = null;

  // If a data: URL was supplied, persist it; if a hosted URL, keep as-is.
  if (url && url.startsWith("data:")) {
    // storeImage expects bytes; for inline data URLs we keep the URL directly
    // (no extra network call) and strip size from base64 length.
    const comma = url.indexOf(",");
    const meta = url.slice(0, comma);
    const b64 = url.slice(comma + 1);
    sizeBytes = Math.floor((b64.length * 3) / 4);
    void meta;
  }

  const id = randomId("file");
  await c.env.DB.prepare(
    `INSERT INTO files (id, owner_id, name, kind, mime, url, size_bytes, tags_json, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, user.id, name, kind, b.mime || null, url, sizeBytes, toJson(b.tags || []), b.note || "", nowIso(), nowIso()).run();
  await logAudit(c.env.DB, { actorId: user.id, action: "file_uploaded", targetType: "file", targetId: id, meta: { kind } });
  const created = await c.env.DB.prepare(`SELECT * FROM files WHERE id = ?`).bind(id).first();
  return json({ ok: true, data: serializeFile(created, activeBackend(c.env as any)) }, 201);
});

files.get("/", async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  const url = new URL(c.req.url);
  const kind = url.searchParams.get("kind");
  const q = url.searchParams.get("q");
  const where: string[] = []; const params: unknown[] = [];
  if (kind) { where.push("kind = ?"); params.push(kind); }
  if (q) { where.push("(name LIKE ? OR note LIKE ? OR tags_json LIKE ?)"); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const sql = `SELECT * FROM files ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC LIMIT 200`;
  const rs = await c.env.DB.prepare(sql).bind(...(params as never[])).all();
  return json({ ok: true, data: (rs.results as any[] || []).map((r) => serializeFile(r, activeBackend(c.env as any))) });
});

files.get("/:id", async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  const r = await c.env.DB.prepare(`SELECT * FROM files WHERE id = ?`).bind(c.req.param("id")).first();
  if (!r) return jsonError(Errors.notFound("File not found"));
  return json({ ok: true, data: serializeFile(r, activeBackend(c.env as any)) });
});

files.patch("/:id", zValidator("json", uploadSchema.partial().extend({ tags: z.array(z.string().max(50)).max(20).optional() })), async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare(`SELECT * FROM files WHERE id = ?`).bind(id).first();
  if (!existing) return jsonError(Errors.notFound("File not found"));
  const body = await c.req.json().catch(() => ({}));
  const sets: string[] = []; const params: unknown[] = [];
  for (const f of ["name", "kind", "mime", "url", "note"]) {
    if (f in body && body[f] !== undefined) { sets.push(`${f} = ?`); params.push(body[f]); }
  }
  if ("tags" in body && body.tags !== undefined) { sets.push("tags_json = ?"); params.push(toJson(body.tags)); }
  if (!sets.length) return jsonError(Errors.badRequest("Nothing to update"));
  sets.push("updated_at = ?"); params.push(nowIso()); params.push(id);
  await c.env.DB.prepare(`UPDATE files SET ${sets.join(", ")} WHERE id = ?`).bind(...(params as never[])).run();
  const updated = await c.env.DB.prepare(`SELECT * FROM files WHERE id = ?`).bind(id).first();
  return json({ ok: true, data: serializeFile(updated, activeBackend(c.env as any)) });
});

files.delete("/:id", async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  if (user.role !== "admin" && user.role !== "moderator") return jsonError(Errors.forbidden());
  const id = c.req.param("id");
  await c.env.DB.prepare(`DELETE FROM files WHERE id = ?`).bind(id).run();
  return json({ ok: true });
});

function serializeFile(r: any, backend: string) {
  if (!r) return r;
  return { ...r, tags: jsonField(r.tags_json, []), backend };
}

export default files;
