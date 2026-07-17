// Logging: audit log + analytics events. Always recorded server-side.
import type { D1Database } from "@cloudflare/workers-types";
import { randomId, nowIso } from "../lib/crypto";
import { toJson } from "./db";
import type { Env } from "../lib/env";

export async function logAudit(
  db: D1Database,
  params: {
    actorId?: string | null;
    action: string;
    targetType?: string | null;
    targetId?: string | null;
    meta?: Record<string, unknown>;
    ip?: string | null;
  }
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, meta_json, ip, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        randomId("aud"),
        params.actorId ?? null,
        params.action,
        params.targetType ?? null,
        params.targetId ?? null,
        toJson(params.meta ?? {}),
        params.ip ?? null,
        nowIso()
      )
      .run();
  } catch (e) {
    console.error("audit log failed", e);
  }
}

export async function logAnalytics(
  db: D1Database,
  eventType: string,
  userId?: string | null,
  meta: Record<string, unknown> = {}
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO analytics_events (id, event_type, user_id, meta_json, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(randomId("ev"), eventType, userId ?? null, toJson(meta), nowIso())
      .run();
  } catch (e) {
    console.error("analytics log failed", e);
  }
}

// Helper to record both audit + analytics in common admin flows.
export async function auditAdmin(
  db: D1Database,
  env: Env,
  actorId: string | null,
  action: string,
  targetType: string | null,
  targetId: string | null,
  ip: string | null,
  meta: Record<string, unknown> = {}
): Promise<void> {
  await logAudit(db, { actorId, action, targetType, targetId, meta, ip });
}

export async function getAnalyticsSummary(db: D1Database): Promise<Record<string, number>> {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const rs = await db
    .prepare(
      `SELECT event_type, COUNT(*) as c FROM analytics_events WHERE created_at >= ?
       GROUP BY event_type ORDER BY c DESC`
    )
    .bind(since)
    .all();
  const out: Record<string, number> = {};
  for (const row of (rs.results as { event_type: string; c: number }[]) || []) {
    out[row.event_type] = row.c;
  }
  return out;
}
