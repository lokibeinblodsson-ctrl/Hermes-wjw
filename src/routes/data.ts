// Data management routes: backup (export), restore (import), and one-time
// sample-card seeding. Backup/restore live under /api/v1/data and are also
// surfaced in the admin panel Data tab + board toolbar.
import { Hono } from "hono";
import { Env } from "../lib/env";
import { json, jsonError, Errors } from "../lib/errors";
import { resolveSession } from "../db/users";
import { ROLE_RANK } from "../lib/auth";
import { randomId, nowIso, toJson, jsonField } from "../lib/crypto";
import { logAudit } from "../db/logging";
import { ensureDefaults } from "../bootstrap";
import {
  APP_NAME,
  APP_VERSION,
  BACKUP_SCHEMA_VERSION,
  BACKUP_MANUAL_MD,
  cardsChecksum,
} from "../lib/appMeta";
import { SAMPLE_CARDS } from "../lib/sampleCards";

const data = new Hono<{ Bindings: Env }>();
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
    draft: r.draft ?? null,
    notes: r.notes ?? null,
    content_pillar: r.content_pillar ?? null,
    research_page_id: r.research_page_id ?? null,
  };
}

async function allCards(db: D1DatabaseLike): Promise<any[]> {
  const rs = await db.prepare(`SELECT * FROM cards ORDER BY column_id, position`).all();
  return ((rs.results as any[]) || []).map(serializeCard);
}

// ── Backup (export) ──────────────────────────────────────────────────────────
// Any authenticated user can download a backup.
data.get("/backup", async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  const cards = await allCards(c.env.DB);
  const mediaCount = cards.reduce((n, card) => n + (Array.isArray(card.media) ? card.media.length : 0), 0);
  const checksum = await cardsChecksum(cards);
  const backup = {
    app_name: APP_NAME,
    version: APP_VERSION,
    schema_version: BACKUP_SCHEMA_VERSION,
    timestamp: nowIso(),
    card_count: cards.length,
    media_count: mediaCount,
    checksum,
    manual: BACKUP_MANUAL_MD,
    cards,
  };
  await logAudit(c.env.DB, { actorId: user.id, action: "backup_exported", meta: { card_count: cards.length } });
  return json({ ok: true, data: backup });
});

// ── Restore (import) ─────────────────────────────────────────────────────────
// Moderator+ only — replaces board state. Accepts the new envelope format OR a
// bare flat array of cards (old export format). A `confirm: true` field is
// required to actually replace; otherwise we return a dry-run validation report.
data.post("/restore", async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  if (ROLE_RANK[user.role] < ROLE_RANK.moderator) {
    return jsonError(Errors.forbidden("Moderator+ required to restore"));
  }
  const raw = await c.req.json().catch(() => null);
  if (!raw) return jsonError(Errors.badRequest("Invalid JSON body"));

  // Accept: { backup: {...}, confirm } | { cards: [...], confirm } | flat array.
  let payload: any = raw;
  let confirm = false;
  if (Array.isArray(raw)) {
    payload = { cards: raw };
  } else {
    confirm = !!raw.confirm;
    if (raw.backup) payload = raw.backup;
  }

  const cards: any[] = Array.isArray(payload.cards) ? payload.cards : Array.isArray(payload) ? payload : [];
  if (!Array.isArray(cards)) return jsonError(Errors.badRequest("Backup contains no cards array"));

  const warnings: string[] = [];
  // Schema version check.
  if (payload.schema_version && payload.schema_version !== BACKUP_SCHEMA_VERSION) {
    warnings.push(`Schema version mismatch: file is v${payload.schema_version}, current is v${BACKUP_SCHEMA_VERSION}. Fields may not map cleanly.`);
  }
  // Checksum check (only when the file carried one).
  if (payload.checksum) {
    const computed = await cardsChecksum(cards);
    if (computed !== payload.checksum) {
      warnings.push("Checksum mismatch: the cards data may have been modified since export.");
    }
  } else {
    warnings.push("No checksum present in file (old flat format) — integrity not verified.");
  }

  if (!confirm) {
    return json({
      ok: true,
      data: { dry_run: true, card_count: cards.length, warnings, message: "Validation only. Re-send with confirm:true to replace board state." },
    });
  }

  // Replace board state: wipe cards, ensure a column exists, insert each card.
  await ensureDefaults(c.env.DB);
  const firstCol = await c.env.DB.prepare(`SELECT id FROM board_columns ORDER BY position ASC LIMIT 1`).first();
  const fallbackCol = firstCol ? (firstCol as { id: string }).id : null;
  if (!fallbackCol) return jsonError(Errors.badRequest("No board column available to restore into"));

  const validCols = new Set(
    (((await c.env.DB.prepare(`SELECT id FROM board_columns`).all()).results as any[]) || []).map((r) => r.id)
  );

  await c.env.DB.prepare(`DELETE FROM cards`).run();
  let restored = 0;
  for (const card of cards) {
    const id = card.id && String(card.id).startsWith("card_") ? card.id : randomId("card");
    const columnId = validCols.has(card.column_id) ? card.column_id : fallbackCol;
    await c.env.DB.prepare(
      `INSERT INTO cards (id, column_id, title, description, priority, due_date, category_id, tags_json, assignee_id, created_by, created_at, updated_at, position,
                          draft, checklist, media, resources, custom_fields, notes, content_pillar, platform_ready, platforms, research_page_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, columnId, card.title || "Untitled", card.description || "", card.priority || "medium",
      card.due_date ?? null, card.category_id ?? null, toJson(card.tags || []),
      card.assignee_id ?? null, user.id, card.created_at || nowIso(), nowIso(), card.position ?? 0,
      card.draft ?? null, toJson(card.checklist || []), toJson(card.media || []),
      toJson(card.resources || []), toJson(card.custom_fields || []), card.notes ?? null,
      card.content_pillar ?? null, card.platform_ready ? 1 : 0, toJson(card.platforms || []),
      card.research_page_id ?? null
    ).run();
    restored++;
  }
  await logAudit(c.env.DB, { actorId: user.id, action: "backup_restored", meta: { restored, warnings } });
  return json({ ok: true, data: { restored, warnings } });
});

// ── Seed sample cards (one-time) ─────────────────────────────────────────────
// Admin-only. Only seeds when the board is empty (card_count === 0) so it never
// overwrites existing cards. Creates any missing categories referenced by the
// samples, then inserts all sample cards into the first ("ideas") column.
data.post("/seed", async (c) => {
  const session = await me(c.env.DB, c);
  if (!session) return jsonError(Errors.unauthorized());
  if (ROLE_RANK[session.role] < ROLE_RANK.admin) {
    return jsonError(Errors.forbidden("Admin required to seed sample cards"));
  }
  const user = session; // narrowed: non-null for the rest of the handler
  await ensureDefaults(c.env.DB);
  const countRow = await c.env.DB.prepare(`SELECT count(*) as c FROM cards`).first();
  const existing = (countRow as { c: number }).c;
  if (existing > 0) {
    return json({ ok: true, data: { seeded: 0, skipped: true, message: `Board already has ${existing} card(s); seeding skipped.` } });
  }
  const ideasCol = await c.env.DB.prepare(`SELECT id FROM board_columns ORDER BY position ASC LIMIT 1`).first();
  if (!ideasCol) return jsonError(Errors.badRequest("No board column available to seed into"));
  const columnId = (ideasCol as { id: string }).id;

  // Resolve or create categories referenced by the samples.
  const catByName = new Map<string, string>();
  const catRows = ((await c.env.DB.prepare(`SELECT id, name FROM categories`).all()).results as any[]) || [];
  for (const r of catRows) catByName.set(String(r.name).toLowerCase(), r.id);
  const palette = ["#8aa66f", "#b3a394", "#9a978c", "#8ba1a8", "#cf9f8f", "#a9b394", "#d8c69a", "#b3c2c4"];
  let paletteIdx = 0;
  async function categoryId(name: string): Promise<string> {
    const key = name.toLowerCase();
    if (catByName.has(key)) return catByName.get(key)!;
    const id = randomId("cat");
    const pos = catByName.size;
    await c.env.DB.prepare(
      `INSERT INTO categories (id, name, description, color, position, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, name, "", palette[paletteIdx++ % palette.length], pos, user.id, nowIso(), nowIso()).run();
    catByName.set(key, id);
    return id;
  }

  let seeded = 0;
  for (let i = 0; i < SAMPLE_CARDS.length; i++) {
    const s = SAMPLE_CARDS[i];
    const catId = await categoryId(s.category);
    await c.env.DB.prepare(
      `INSERT INTO cards (id, column_id, title, description, priority, due_date, category_id, tags_json, assignee_id, created_by, created_at, updated_at, position,
                          draft, checklist, media, resources, custom_fields, notes, content_pillar, platform_ready, platforms, research_page_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      randomId("card"), columnId, s.title, s.description, "medium",
      null, catId, toJson(s.tags), null, user.id, nowIso(), nowIso(), i,
      null, "[]", "[]", "[]", "[]", null, s.content_pillar, 0, toJson(s.platforms), null
    ).run();
    seeded++;
  }
  await logAudit(c.env.DB, { actorId: user.id, action: "sample_cards_seeded", meta: { seeded } });
  return json({ ok: true, data: { seeded, skipped: false } }, 201);
});

export default data;
