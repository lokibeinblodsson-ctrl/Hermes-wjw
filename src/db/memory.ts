// RAG memory retrieval + storage service. Combines FTS5 keyword recall with a
// semantic cosine re-rank. Also exposes a decision log + changelog helper.
import type { D1Database } from "@cloudflare/workers-types";
import { randomId, nowIso } from "../lib/crypto";
import { toJson } from "../db/db";
import { computeEmbedding, cosineSimilarity, type RetrievedMemory } from "../lib/memory/embeddings";
import type { MemoryType } from "../lib/types";

interface MemoryRow {
  id: string;
  type: string;
  title: string;
  body: string;
  summary: string;
  tags_json: string;
  embedding_json: string;
  created_at: string;
}

export interface MemoryInput {
  type: MemoryType;
  title: string;
  body?: string;
  summary?: string;
  tags?: string[];
  source?: string;
  created_by?: string | null;
}

export async function addMemory(db: D1Database, input: MemoryInput): Promise<string> {
  const id = randomId("mem");
  const summary = input.summary || (input.body || input.title).slice(0, 280);
  const text = `${input.title} ${summary} ${input.body || ""} ${(input.tags || []).join(" ")}`;
  const embedding = computeEmbedding(text);
  await db
    .prepare(
      `INSERT INTO memory_notes (id, type, title, body, summary, tags_json, source, embedding_json, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      input.type,
      input.title,
      input.body || "",
      summary,
      toJson(input.tags || []),
      input.source || "",
      toJson(embedding),
      input.created_by ?? null,
      nowIso(),
      nowIso()
    )
    .run();
  return id;
}

// Semantic + keyword retrieval over project memory.
export async function retrieveMemory(
  db: D1Database,
  query: string,
  opts: { type?: MemoryType; limit?: number; since?: string } = {}
): Promise<RetrievedMemory[]> {
  const limit = opts.limit ?? 10;
  const embedding = computeEmbedding(query);

  // 1) Keyword recall via FTS5
  const fts = await db
    .prepare(
      `SELECT m.rowid, m.id, bm25(memory_fts) as rank
       FROM memory_fts
       JOIN memory_notes m ON m.rowid = memory_fts.rowid
       WHERE memory_fts MATCH ?
       ${opts.type ? "AND m.type = ?" : ""}
       ORDER BY rank
       LIMIT ?`
    )
    .bind(query, ...(opts.type ? [opts.type] : []), limit * 3)
    .all();
  const ftsRows = (fts.results as { id: string; rank: number }[]) || [];

  // 2) Semantic recall: score ALL candidate notes by cosine sim (cheap at this scale)
  const whereType = opts.type ? "WHERE type = ?" : "";
  const params = opts.type ? [opts.type] : [];
  const allRows = await db
    .prepare(
      `SELECT id, type, title, summary, embedding_json, created_at FROM memory_notes ${whereType}`
    )
    .bind(...(params as never[]))
    .all();
  const semScored: { id: string; sim: number }[] = [];
  const base: RetrievedMemory[] = [];
  for (const r of (allRows.results as unknown as MemoryRow[]) || []) {
    const emb = JSON.parse(r.embedding_json || "[]") as number[];
    const sim = cosineSimilarity(embedding, emb);
    semScored.push({ id: r.id, sim });
    base.push({
      id: r.id,
      type: r.type,
      title: r.title,
      summary: r.summary,
      score: 0,
      created_at: r.created_at,
    });
  }
  semScored.sort((a, b) => b.sim - a.sim);
  const topSem = new Set(semScored.slice(0, limit * 3).map((s) => s.id));

  // 3) Combine scores
  const byId = new Map(base.map((b) => [b.id, b]));
  const combined = new Map<string, number>();
  for (const r of ftsRows) {
    combined.set(r.id, (combined.get(r.id) || 0) + 0.6 * (1 / (1 + r.rank)));
  }
  for (const s of semScored) {
    if (topSem.has(s.id)) combined.set(s.id, (combined.get(s.id) || 0) + 0.4 * Math.max(0, s.sim));
  }

  const results: RetrievedMemory[] = [];
  for (const [id, score] of combined.entries()) {
    const m = byId.get(id);
    if (!m) continue;
    results.push({ ...m, score });
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

// Decision log convenience: store a verified decision/choice.
export function logDecision(db: D1Database, title: string, body: string, created_by?: string | null) {
  return addMemory(db, { type: "decision", title, body, created_by, tags: ["decision-log"], source: "admin" });
}

// Changelog convenience: store an important action/change.
export function logChangelog(db: D1Database, title: string, body: string, created_by?: string | null) {
  return addMemory(db, { type: "changelog", title, body, created_by, tags: ["changelog"], source: "system" });
}

// Time-based recall: notes created since a date (or last N days).
export async function recallSince(db: D1Database, sinceIso: string, limit = 20): Promise<RetrievedMemory[]> {
  const rs = await db
    .prepare(
      `SELECT id, type, title, summary, created_at FROM memory_notes WHERE created_at >= ? ORDER BY created_at DESC LIMIT ?`
    )
    .bind(sinceIso, limit)
    .all();
  return ((rs.results as unknown as MemoryRow[]) || []).map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    summary: r.summary,
    score: 1,
    created_at: r.created_at,
  }));
}
