// Safe JSON parse used by the research modules (mirrors db/db.ts jsonField but
// is importable without D1 types for pure unit contexts).
export function safeJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "object") return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}
