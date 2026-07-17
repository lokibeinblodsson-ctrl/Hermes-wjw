// Lightweight semantic embeddings (closed-form, deterministic).
// (Reuses no external crypto; pure functions below.)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
// NOTE: This is a transparent, dependency-free semantic vector built from
// TF-IDF-style lexical semantics. It is NOT a transformer embedding and will
// not capture deep paraphrase similarity, but it gives genuinely useful
// semantic-ish retrieval (synonyms sharing stems ~ partial; same-terms ~ high)
// and, crucially, a stable recompute-able vector. The system keeps a BM25/FTS5
// keyword path as the primary recall, then re-ranks with cosine similarity on
// this vector as the semantic booster. On a real Cloudflare Worker you can
// replace computeEmbedding() with a vectorize binding call without changing the
// retrieval API.
import { hashToken } from "../crypto"; // reuse sha256 primitive indirectly

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with", "as", "is",
  "are", "was", "were", "be", "been", "being", "this", "that", "these", "those", "it", "its",
  "we", "you", "they", "i", "he", "she", "at", "by", "from", "can", "will", "would", "should",
  "could", "do", "does", "did", "have", "has", "had", "not", "no", "yes", "if", "then", "than",
]);

export const EMBED_DIM = 256;

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9_]+/g) || [])
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function stem(word: string): string {
  // crude suffix stripping
  return word
    .replace(/(ies|ied)$/, "y")
    .replace(/(ing|ed|es|s)$/, "")
    .replace(/(ment|ness|tion|able|ible|ful|less|ize|ise)$/, "");
}

// Build a hashed lexical vector: hash each (stemmed) token to a bucket and
// accumulate TF (term frequency) weighted by IDF at query time externally.
// We approximate IDF with a fixed collection-agnostic weight here, which keeps
// vectors stable and comparable across inserts. Cosine similarity still works.
export function computeEmbedding(text: string): number[] {
  const tokens = tokenize(text).map(stem);
  const vec = new Array(EMBED_DIM).fill(0);
  if (tokens.length === 0) return vec;
  for (const t of tokens) {
    const h = fnv1a(t) % EMBED_DIM;
    vec[h] += 1;
  }
  // L2 normalize
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface RetrievedMemory {
  id: string;
  type: string;
  title: string;
  summary: string;
  score: number;
  created_at: string;
}

// Combine FTS5 keyword match + semantic cosine re-rank.
export function combineScores(
  ftsRows: { id: string; rank: number }[],
  semRows: { id: string; sim: number }[],
  alpha = 0.6
): Map<string, number> {
  const scores = new Map<string, number>();
  const maxRank = Math.max(1, ...ftsRows.map((r) => r.rank));
  for (const r of ftsRows) {
    const ftsScore = 1 - (r.rank - 1) / maxRank; // higher rank# = worse
    scores.set(r.id, (scores.get(r.id) || 0) + alpha * ftsScore);
  }
  for (const r of semRows) {
    scores.set(r.id, (scores.get(r.id) || 0) + (1 - alpha) * Math.max(0, r.sim));
  }
  return scores;
}
