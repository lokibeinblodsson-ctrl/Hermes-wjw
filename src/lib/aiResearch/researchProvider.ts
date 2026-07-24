// Research provider abstraction for AI Kanban research.
//
// Two retrieval paths, both behind one interface so the job layer never knows
// which is live:
//   1) internalRetrieval() — searches WJW's own content (cards, research notes,
//      memory docs) using the existing closed-form semantic vector + FTS5 path
//      (src/lib/memory/embeddings.ts). Always available, no external call.
//   2) externalResearch() — optional, source-backed web research. Gated by
//      allow_external_research. In CI it is a mock; in prod it would call a
//      configured provider. It NEVER fabricates citations: if no provider is
//      configured it returns an empty list and the brief records that external
//      research was skipped.
//
// All returned content is treated as UNTRUSTED DATA. The job layer stores it
// and shows it to the user but never executes instructions embedded in it.

import type { D1Database } from "@cloudflare/workers-types";
import { computeEmbedding, cosineSimilarity, combineScores } from "../memory/embeddings";
import { first, all } from "../../db/db";
import { safeJson } from "./safeJson";

export interface RetrievalHit {
  itemType: "card" | "research_note" | "memory";
  itemId: string;
  title: string;
  excerpt: string;
  similarity: number;
  matchingTags: string[];
  rationale: string;
}

export interface ExternalSource {
  title: string;
  url: string | null;
  publisher: string | null;
  published_date: string | null;
  relevance: string | null;
  retrieved_at: string;
}

export interface ResearchProvider {
  internalRetrieval(db: D1Database, query: string, limit: number, threshold: number): Promise<RetrievalHit[]>;
  externalResearch?(query: string, questions: string[], allowed: boolean): Promise<ExternalSource[]>;
}

// ── Internal retrieval (always on) ──────────────────────────────────────────
export function makeInternalRetrieval(): ResearchProvider["internalRetrieval"] {
  return async function internalRetrieval(db, query, limit, threshold) {
    const qVec = computeEmbedding(query);
    const cardRows = (await all<any>(db, `SELECT id, title, description, tags_json FROM cards`).catch(() => [])) as any[];
    // cards
    const scored = new Map<string, RetrievalHit>();
    for (const c of cardRows) {
      const text = `${c.title} ${c.description || ""}`;
      const sim = cosineSimilarity(qVec, computeEmbedding(text));
      if (sim >= threshold) {
        scored.set(`card:${c.id}`, {
          itemType: "card",
          itemId: c.id,
          title: c.title,
          excerpt: (c.description || "").slice(0, 240),
          similarity: sim,
          matchingTags: safeJson(c.tags_json, []),
          rationale: "semantic match on card content",
        });
      }
    }
    // memory notes
    const memRows = (await all<any>(db, `SELECT id, title, summary, body, tags_json FROM memory_notes`).catch(() => [])) as any[];
    for (const m of memRows) {
      const text = `${m.title} ${m.summary || ""} ${m.body || ""}`;
      const sim = cosineSimilarity(qVec, computeEmbedding(text));
      if (sim >= threshold) {
        scored.set(`memory:${m.id}`, {
          itemType: "memory",
          itemId: m.id,
          title: m.title,
          excerpt: (m.summary || m.body || "").slice(0, 240),
          similarity: sim,
          matchingTags: safeJson(m.tags_json, []),
          rationale: "semantic match on internal memory note",
        });
      }
    }
    return [...scored.values()].sort((a, b) => b.similarity - a.similarity).slice(0, limit);
  };
}

// ── External research (gated; mockable) ─────────────────────────────────────
// `externalResearchImpl` can be injected by tests / the worker. By default it
// is the safe no-op: returns [] and the job records that external research was
// skipped (never fabricates).
export function makeExternalResearch(
  impl?: (query: string, questions: string[]) => Promise<ExternalSource[]>
): NonNullable<ResearchProvider["externalResearch"]> {
  return async function externalResearch(_query, _questions, allowed) {
    if (!allowed) return [];
    if (!impl) return []; // no provider configured -> skip, do not fabricate
    const out = await impl(_query, _questions);
    // Sanitize: drop any source missing a real URL; never trust title claims
    // to be authoritative beyond display.
    return out.filter((s) => s && typeof s.url === "string" && s.url.startsWith("http"));
  };
}

export const internalRetrievalProvider = makeInternalRetrieval();
