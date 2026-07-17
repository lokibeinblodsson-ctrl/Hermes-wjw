// Misc API routes: public-ish summary endpoints, memory semantic search
// (used by Hermes / agents), and a logs endpoint for the app's activity feed.
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { Env } from "../lib/env";
import { json, jsonError, Errors } from "../lib/errors";
import { memoryQuerySchema } from "../lib/validation";
import { resolveSession } from "../db/users";
import { retrieveMemory, recallSince } from "../db/memory";
import { getAnalyticsSummary } from "../db/logging";
import { jsonField } from "../lib/crypto";

const api = new Hono<{ Bindings: Env }>();
type D1DatabaseLike = import("@cloudflare/workers-types").D1Database;

async function me(db: D1DatabaseLike, c: any): Promise<ReturnType<typeof resolveSession>> {
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

// Activity feed (recent audit + analytics) — any authenticated user.
api.get("/activity", async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  const rs = await c.env.DB.prepare(`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 25`).all();
  const rows = ((rs.results as any[]) || []).map((r) => ({ ...r, meta: jsonField(r.meta_json, {}) }));
  return json({ ok: true, data: rows });
});

// Logs endpoint (last N) — any authenticated user (read-only feed).
api.get("/logs", async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  const limit = Math.min(200, parseInt(new URL(c.req.url).searchParams.get("limit") || "50"));
  const rs = await c.env.DB.prepare(`SELECT id, action, actor_id, target_type, target_id, created_at FROM analytics_events ORDER BY created_at DESC LIMIT ?`).bind(limit).all();
  return json({ ok: true, data: rs.results || [] });
});

// Semantic memory search — authenticated users (agents use a service token).
api.get("/memory/search", zValidator("query", memoryQuerySchema), async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  const { q, type, limit, since } = c.req.query() as unknown as { q: string; type?: string; limit?: string; since?: string };
  let results;
  if (since) {
    results = await recallSince(c.env.DB, since, parseInt(limit || "20"));
  } else {
    results = await retrieveMemory(c.env.DB, q, {
      type: type as any,
      limit: parseInt(limit || "10"),
    });
  }
  return json({ ok: true, data: results });
});

// Analytics summary — authenticated.
api.get("/analytics/summary", async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  const summary = await getAnalyticsSummary(c.env.DB);
  return json({ ok: true, data: summary });
});

export default api;
