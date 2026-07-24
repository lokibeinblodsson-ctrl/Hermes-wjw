// Pure AI-research logic: intake schema, malformed-output repair, tag
// normalization/aliasing, and relationship scoring/dedup. NO I/O here so it is
// fully unit-testable and safe to call from any job/route. All model output is
// treated as untrusted DATA: we validate against a strict schema, repair what
// we can, and drop the rest. Never let partial model output crash a run.

import { z } from "zod";

// ── Intake schema (strict; model output must conform) ───────────────────────
export const INTENT = [
  "research",
  "decision",
  "implementation",
  "bug",
  "inquiry",
  "planning",
  "other",
] as const;

export const IntakeSchema = z.object({
  topic_summary: z.string().max(2000).default(""),
  primary_topic: z.string().max(300).default(""),
  entities: z.array(z.string().max(200)).default([]),
  intent: z.enum(INTENT).default("other"),
  priority_signals: z.array(z.string().max(200)).default([]),
  initial_tags: z.array(z.string().max(80)).default([]),
  research_questions: z.array(z.string().max(500)).default([]),
  confidence: z.number().min(0).max(1).default(0.5),
  needs_human_clarification: z.boolean().default(false),
  clarification_questions: z.array(z.string().max(300)).default([]),
});
export type Intake = z.infer<typeof IntakeSchema>;

// Validate model output; on failure, try to repair common issues (wrong types,
// extra keys, arrays-of-objects where strings expected). Returns null if the
// output cannot be made safe — the caller then records a failed run.
export function validateIntake(raw: unknown): { ok: true; data: Intake } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "intake must be an object" };
  }
  const result = IntakeSchema.safeParse(coerceIntake(raw));
  if (result.success) return { ok: true, data: result.data };
  // Surface the first issue for the audit log.
  const issue = result.error.issues[0];
  return { ok: false, error: `${issue?.path?.join(".") || "?"}: ${issue?.message ?? "invalid"}` };
}

// Best-effort coercion so a slightly-off model payload still parses. We never
// coerce in a way that could inject instructions — strings stay strings.
function coerceIntake(raw: any): any {
  if (!raw || typeof raw !== "object") return {};
  const arr = (v: any) => (Array.isArray(v) ? v : v == null ? [] : [v]);
  const strArr = (v: any) => arr(v).map((x) => (typeof x === "string" ? x : typeof x === "object" ? JSON.stringify(x) : String(x))).slice(0, 40);
  const str = (v: any) => (typeof v === "string" ? v : v == null ? "" : typeof v === "boolean" || typeof v === "number" ? String(v) : "");
  return {
    topic_summary: str(raw.topic_summary),
    primary_topic: str(raw.primary_topic),
    entities: strArr(raw.entities).slice(0, 30),
    intent: INTENT.includes(raw.intent) ? raw.intent : "other",
    priority_signals: strArr(raw.priority_signals),
    initial_tags: strArr(raw.initial_tags),
    research_questions: strArr(raw.research_questions).slice(0, 12),
    confidence: typeof raw.confidence === "number" ? Math.min(1, Math.max(0, raw.confidence)) : 0.5,
    needs_human_clarification: !!raw.needs_human_clarification,
    clarification_questions: strArr(raw.clarification_questions),
  };
}

// ── Tag normalization + alias resolution ────────────────────────────────────
// Canonicalize a raw tag: lowercase, trim, collapse whitespace/punctuation that
// the taxonomy disallows. Aliases are resolved by a caller-supplied map.
const STOPWORDS = new Set(["the", "a", "an", "and", "or", "of", "to", "for", "in", "on", "with"]);

export function normalizeTag(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .trim();
}

// Collapse user/AI tags into canonical entries, dropping stopwords and empties.
// `aliasToCanonical` maps an alias to its canonical name (already normalized).
export function consolidateTags(
  tags: string[],
  aliasToCanonical: Record<string, string> = {}
): { canonical: string[]; rejected: string[] } {
  const seen = new Set<string>();
  const rejected: string[] = [];
  for (const t of tags) {
    const norm = normalizeTag(t);
    if (!norm || STOPWORDS.has(norm)) {
      rejected.push(t);
      continue;
    }
    const canonical = aliasToCanonical[norm] || norm;
    seen.add(canonical);
  }
  return { canonical: [...seen], rejected };
}

// Build alias lookup from a list of {alias, canonical} where canonical is the
// normalized canonical name.
export function buildAliasMap(aliases: { alias: string; canonical: string }[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const a of aliases) m[normalizeTag(a.alias)] = normalizeTag(a.canonical);
  return m;
}

// ── Relationship scoring + dedup ────────────────────────────────────────────
export const RELATIONSHIP_TYPES = [
  "related_to",
  "duplicate_of",
  "follow_up_to",
  "implementation_of",
  "background_for",
  "blocks",
  "blocked_by",
  "depends_on",
  "contradicts",
] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export interface LinkCandidate {
  source_card_id: string;
  target_card_id: string;
  relationship_type: RelationshipType;
  confidence: number;
  explanation: string;
  evidence: string[];
}

// Score a potential link from signals. Returns 0 when it must not become a link.
export function scoreLink(input: {
  sharedTags: number;
  sharedEntities: number;
  similarity?: number; // 0..1 retrieval similarity
  aiConfidence?: number; // 0..1 if AI asserted a relationship
}): number {
  let s = 0;
  s += Math.min(input.sharedTags || 0, 4) * 0.15; // up to 0.6
  s += Math.min(input.sharedEntities || 0, 3) * 0.1; // up to 0.3
  if (typeof input.similarity === "number" && !Number.isNaN(input.similarity)) s = Math.max(s, input.similarity);
  if (typeof input.aiConfidence === "number" && !Number.isNaN(input.aiConfidence)) s = Math.max(s, input.aiConfidence);
  return Math.min(1, s);
}

// Drop self-links and reversed-duplicate links. A link (A->B, T) and (B->A, T)
// are the same relationship; keep the lower-id source as canonical direction.
export function dedupeLinks(candidates: LinkCandidate[]): LinkCandidate[] {
  const best = new Map<string, LinkCandidate>();
  for (const c of candidates) {
    if (c.source_card_id === c.target_card_id) continue; // no self-links
    // Canonicalize the unordered pair for symmetric types so we don't double.
    // Store the canonical direction (lower id = source) for symmetric types.
    const symmetric = c.relationship_type === "related_to" || c.relationship_type === "contradicts";
    let key: string;
    let link = c;
    if (symmetric) {
      const [a, b] = [c.source_card_id, c.target_card_id].sort();
      key = `${a}|${b}|${c.relationship_type}`;
      if (a !== c.source_card_id) {
        link = { ...c, source_card_id: a, target_card_id: b };
      }
    } else {
      key = `${c.source_card_id}|${c.target_card_id}|${c.relationship_type}`;
    }
    const existing = best.get(key);
    if (!existing || link.confidence > existing.confidence) best.set(key, link);
  }
  return [...best.values()];
}

// Auto-approve a link only when confidence exceeds the configured threshold AND
// not already rejected. Otherwise it stays 'proposed' for human review.
export function decideLinkStatus(
  confidence: number,
  threshold: number,
  rejectedKeys: Set<string>
): "approved" | "proposed" {
  const key = `${confidence >= threshold}`;
  if (rejectedKeys.has(key)) return "proposed";
  return confidence >= threshold ? "approved" : "proposed";
}

// Content hash for idempotency: meaningful fields only.
export function cardContentHash(card: {
  title: string;
  description: string;
  tags_json?: string;
  notes?: string | null;
}): string {
  const tags = card.tags_json ? safeJsonArray(card.tags_json) : [];
  const meaningful = JSON.stringify({
    t: card.title,
    d: card.description,
    g: tags,
    n: card.notes ?? "",
  });
  // FNV-1a 32-bit — cheap, dependency-free, good enough for dedup-by-revision.
  let h = 0x811c9dc5;
  for (let i = 0; i < meaningful.length; i++) {
    h ^= meaningful.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function safeJsonArray(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}
