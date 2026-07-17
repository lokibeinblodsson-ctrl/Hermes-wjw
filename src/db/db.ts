// Thin DB helper layer: row mapping, JSON columns, and convenience wrappers.
import type { D1Database } from "@cloudflare/workers-types";

export interface DbRow {
  [key: string]: unknown;
}

export function jsonField<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "object") return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

export function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

// Map a DB row's JSON columns to parsed objects.
export function mapRow<T>(row: DbRow | null, jsonColumns: Record<string, unknown> = {}): T | null {
  if (!row) return null;
  const out: Record<string, unknown> = { ...row };
  for (const [col, fb] of Object.entries(jsonColumns)) {
    if (col in out) out[col] = jsonField(out[col], fb);
  }
  return out as T;
}

export function rows<T>(rs: { results: unknown[] } | null, jsonColumns: Record<string, unknown> = {}): T[] {
  if (!rs || !rs.results) return [];
  return (rs.results as DbRow[]).map((r) => mapRow<T>(r, jsonColumns)!);
}

export async function first<T>(
  db: D1Database,
  sql: string,
  params: unknown[] = [],
  jsonColumns: Record<string, unknown> = {}
): Promise<T | null> {
  const r = await db.prepare(sql).bind(...(params as never[])).first();
  return mapRow<T>(r as DbRow | null, jsonColumns);
}

export async function all<T>(
  db: D1Database,
  sql: string,
  params: unknown[] = [],
  jsonColumns: Record<string, unknown> = {}
): Promise<T[]> {
  const r = await db.prepare(sql).bind(...(params as never[])).all();
  return rows<T>(r as { results: unknown[] }, jsonColumns);
}

export async function run(
  db: D1Database,
  sql: string,
  params: unknown[] = []
): Promise<{ meta: unknown }> {
  await db.prepare(sql).bind(...(params as never[])).run();
  return { meta: null };
}

export function nowIso(): string {
  return new Date().toISOString();
}
