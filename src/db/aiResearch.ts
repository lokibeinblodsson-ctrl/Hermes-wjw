// DB access helpers for AI research: runs, research notes, sources, tags, and
// card links. Pure data access — permission checks live in the route layer and
// in permissions.ts. All writes record created_by/updated_at.
import type { D1Database } from "@cloudflare/workers-types";
import { randomId, nowIso, toJson, jsonField } from "../lib/crypto";
import { first, all } from "./db";

// ── Runs ────────────────────────────────────────────────────────────────────
export async function createRun(
  db: D1Database,
  cardId: string,
  trigger: string,
  contentHash: string,
  intakeJson: unknown,
  configJson: unknown,
  createdBy: string | null
): Promise<string> {
  const id = randomId("run");
  await db
    .prepare(
      `INSERT INTO card_ai_runs (id, card_id, trigger, status, content_hash, intake_json, config_json, created_by, created_at, updated_at)
       VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, cardId, trigger, contentHash, toJson(intakeJson), toJson(configJson), createdBy, nowIso(), nowIso())
    .run();
  return id;
}

export async function setRunStatus(
  db: D1Database,
  runId: string,
  status: string,
  error?: string
): Promise<void> {
  const completed = status === "completed" || status === "failed" || status === "cancelled" ? nowIso() : null;
  await db
    .prepare(`UPDATE card_ai_runs SET status = ?, error = ?, updated_at = ?, completed_at = COALESCE(?, completed_at) WHERE id = ?`)
    .bind(status, error ?? null, nowIso(), completed, runId)
    .run();
}

export async function activeRunForCard(db: D1Database, cardId: string): Promise<boolean> {
  const r = await first<{ id: string }>(
    db,
    `SELECT id FROM card_ai_runs WHERE card_id = ? AND status IN ('queued','running') LIMIT 1`,
    [cardId]
  );
  return !!r;
}

export async function runByHash(db: D1Database, cardId: string, contentHash: string): Promise<{ id: string; status: string } | null> {
  return first<{ id: string; status: string }>(
    db,
    `SELECT id, status FROM card_ai_runs WHERE card_id = ? AND content_hash = ? ORDER BY created_at DESC LIMIT 1`,
    [cardId, contentHash]
  );
}

// ── Research notes (brief) ───────────────────────────────────────────────────
export async function createResearchNote(
  db: D1Database,
  cardId: string,
  runId: string,
  version: number,
  contentJson: unknown,
  sources: unknown[],
  appliedTags: unknown[],
  proposedTags: unknown[],
  proposedLinks: unknown[],
  createdBy: string | null
): Promise<string> {
  const id = randomId("rn");
  await db
    .prepare(
      `INSERT INTO card_research_notes
        (id, card_id, run_id, version, status, content_json, sources_json, applied_tags_json, proposed_tags_json, proposed_links_json, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, cardId, runId, version, toJson(contentJson), toJson(sources), toJson(appliedTags), toJson(proposedTags), toJson(proposedLinks), createdBy, nowIso(), nowIso())
    .run();
  return id;
}

export async function latestResearchNote(db: D1Database, cardId: string): Promise<any | null> {
  return first<any>(
    db,
    `SELECT * FROM card_research_notes WHERE card_id = ? ORDER BY version DESC LIMIT 1`,
    [cardId],
    { sources_json: [], applied_tags_json: [], proposed_tags_json: [], proposed_links_json: [], content_json: {} }
  );
}

// ── Sources ────────────────────────────────────────────────────────────────
export async function insertSources(db: D1Database, noteId: string, sources: { title?: string; url?: string | null; publisher?: string | null; published_date?: string | null; relevance?: string | null; retrieved_at?: string }[]): Promise<void> {
  for (const s of sources) {
    await db
      .prepare(
        `INSERT INTO research_sources (id, note_id, title, url, publisher, published_date, relevance, retrieved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(randomId("src"), noteId, s.title || "", s.url ?? null, s.publisher || null, s.published_date || null, s.relevance || null, s.retrieved_at || null)
      .run();
  }
}

export async function getSources(db: D1Database, noteId: string): Promise<any[]> {
  return all<any>(db, `SELECT * FROM research_sources WHERE note_id = ? ORDER BY id`, [noteId]);
}

// ── Tags ─────────────────────────────────────────────────────────────────────
export async function upsertTag(db: D1Database, name: string, source: string, createdBy: string | null): Promise<string> {
  const norm = name;
  const existing = await first<{ id: string }>(db, `SELECT id FROM tags WHERE name = ?`, [norm]);
  if (existing) {
    await db.prepare(`UPDATE tags SET usage_count = usage_count + 1 WHERE id = ?`).bind(existing.id).run();
    return existing.id;
  }
  const id = randomId("tag");
  await db
    .prepare(`INSERT INTO tags (id, name, usage_count, source, created_by, created_at) VALUES (?, ?, 1, ?, ?, ?)`)
    .bind(id, norm, source, createdBy, nowIso())
    .run();
  return id;
}

export async function listTags(db: D1Database): Promise<{ id: string; name: string; usage_count: number; source: string }[]> {
  return all<{ id: string; name: string; usage_count: number; source: string }>(db, `SELECT id, name, usage_count, source FROM tags ORDER BY usage_count DESC, name`);
}

export async function listAliases(db: D1Database): Promise<{ alias: string; canonical: string }[]> {
  return all<{ alias: string; canonical: string }>(
    db,
    `SELECT a.alias, t.name as canonical FROM tag_aliases a JOIN tags t ON t.id = a.canonical_tag_id`
  );
}

export async function setCardTag(db: D1Database, cardId: string, tagId: string, source: string, confidence: number, status: string, createdBy: string | null): Promise<void> {
  await db
    .prepare(
      `INSERT INTO card_tags (id, card_id, tag_id, source, confidence, status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(card_id, tag_id) DO UPDATE SET status = excluded.status, confidence = excluded.confidence, source = excluded.source`
    )
    .bind(randomId("ct"), cardId, tagId, source, confidence, status, createdBy, nowIso())
    .run();
}

// Keep the latest research note's applied_tags_json in sync with the card's
// active tags (so GET /research reflects approvals/rejections immediately).
export async function syncNoteAppliedTags(db: D1Database, cardId: string): Promise<void> {
  const note = await latestResearchNote(db, cardId);
  if (!note) return;
  const active = (await all<{ tag_id: string }>(db, `SELECT tag_id FROM card_tags WHERE card_id = ? AND status = 'active'`, [cardId])).map((r) => r.tag_id);
  const proposed = (await all<{ tag_id: string }>(db, `SELECT tag_id FROM card_tags WHERE card_id = ? AND status = 'proposed'`, [cardId])).map((r) => r.tag_id);
  await db
    .prepare(`UPDATE card_research_notes SET applied_tags_json = ?, proposed_tags_json = ? WHERE id = ?`)
    .bind(toJson(active), toJson(proposed), note.id)
    .run();
}

// ── Card links ───────────────────────────────────────────────────────────────
export async function upsertLink(db: D1Database, link: { source_card_id: string; target_card_id: string; relationship_type: string; confidence: number; explanation: string; evidence: string[]; source: string; status: string; createdBy: string | null }): Promise<void> {
  const id = randomId("lnk");
  await db
    .prepare(
      `INSERT INTO card_ai_links (id, source_card_id, target_card_id, relationship_type, confidence, explanation, evidence_json, source, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_card_id, target_card_id, relationship_type) DO UPDATE SET
         confidence = excluded.confidence, explanation = excluded.explanation,
         evidence_json = excluded.evidence_json, status = excluded.status, updated_at = excluded.updated_at`
    )
    .bind(id, link.source_card_id, link.target_card_id, link.relationship_type, link.confidence, link.explanation, toJson(link.evidence), link.source, link.status, link.createdBy, nowIso(), nowIso())
    .run();
}

export async function listCardLinks(db: D1Database, cardId: string): Promise<any[]> {
  return all<any>(db, `SELECT * FROM card_ai_links WHERE (source_card_id = ? OR target_card_id = ?) AND status <> 'rejected' ORDER BY confidence DESC`, [cardId, cardId]);
}

// ── Config ─────────────────────────────────────────────────────────────────
export async function getResearchConfig(db: D1Database, scope: string, scopeId?: string | null): Promise<any | null> {
  // Single-workspace app: one config row keyed by a fixed id.
  return first<any>(db, `SELECT * FROM ai_research_config WHERE id = 'workspace'`);
}
