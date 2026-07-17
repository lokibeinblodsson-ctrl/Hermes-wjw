// Docs route: serves live, auto-generated documentation data. Everything is
// pulled from the live DB / config at request time so the docs never drift from
// reality. The frontend /docs page renders this and offers "Copy as Markdown".
import { Hono } from "hono";
import { Env } from "../lib/env";
import { json, jsonError, Errors } from "../lib/errors";
import { resolveSession } from "../db/users";
import { ensureDefaults } from "../bootstrap";
import { APP_NAME, APP_VERSION, PLATFORMS, CARD_FIELDS } from "../lib/appMeta";

const docs = new Hono<{ Bindings: Env }>();
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

// Live docs payload — any authenticated user.
docs.get("/", async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  await ensureDefaults(c.env.DB);

  const colRows = ((await c.env.DB.prepare(`SELECT id, name, position, color FROM board_columns ORDER BY position ASC`).all()).results as any[]) || [];
  const catRows = ((await c.env.DB.prepare(`SELECT id, name, description, color FROM categories ORDER BY position ASC, name ASC`).all()).results as any[]) || [];

  // Live card counts per column.
  const countRows = ((await c.env.DB.prepare(`SELECT column_id, count(*) as c FROM cards GROUP BY column_id`).all()).results as any[]) || [];
  const countByCol = new Map<string, number>();
  for (const r of countRows) countByCol.set(r.column_id, r.c);
  const totalRow = await c.env.DB.prepare(`SELECT count(*) as c FROM cards`).first();
  const totalCards = (totalRow as { c: number }).c;

  const columns = colRows.map((col) => ({
    id: col.id,
    name: col.name,
    color: col.color,
    card_count: countByCol.get(col.id) || 0,
  }));

  // Live feature status: content pipeline, scheduling, chat, memory, files.
  const contentRows = ((await c.env.DB.prepare(`SELECT status, count(*) as c FROM content_items GROUP BY status`).all()).results as any[]) || [];
  const contentByStatus = new Map<string, number>();
  for (const r of contentRows) contentByStatus.set(r.status, r.c);
  const contentTotal = Array.from(contentByStatus.values()).reduce((a, b) => a + b, 0);

  const scheduledRows = ((await c.env.DB.prepare(
    `SELECT count(*) as c FROM cards WHERE scheduled_date IS NOT NULL AND scheduled_date <> ''`
  ).first()) as { c: number }) || { c: 0 };

  const chatRows = ((await c.env.DB.prepare(
    `SELECT (SELECT count(*) FROM channels) as channels, (SELECT count(*) FROM threads) as threads, (SELECT count(*) FROM messages WHERE deleted_at IS NULL) as messages`
  ).first()) as { channels: number; threads: number; messages: number }) || { channels: 0, threads: 0, messages: 0 };

  const memoryRows = ((await c.env.DB.prepare(
    `SELECT count(*) as c FROM memory_notes`
  ).first()) as { c: number }) || { c: 0 };

  const fileRows = ((await c.env.DB.prepare(
    `SELECT count(*) as c FROM files`
  ).first()) as { c: number }) || { c: 0 };

  return json({
    ok: true,
    data: {
      app_name: APP_NAME,
      version: APP_VERSION,
      generated_at: new Date().toISOString(),
      overview: `${APP_NAME} is an internal content-planning platform for Celina's practice. It combines a kanban board, per-card workspaces, chat, a publishing pipeline, and RAG memory to plan, draft, and publish content across platforms.`,
      columns,
      categories: catRows.map((r) => ({ id: r.id, name: r.name, description: r.description, color: r.color })),
      platforms: PLATFORMS,
      card_fields: CARD_FIELDS,
      board_stats: { total_cards: totalCards, column_count: columns.length, category_count: catRows.length },
      features: {
        content_pipeline: {
          enabled: true,
          total: contentTotal,
          by_status: {
            draft: contentByStatus.get("draft") || 0,
            in_review: contentByStatus.get("in_review") || 0,
            approved: contentByStatus.get("approved") || 0,
            published: contentByStatus.get("published") || 0,
            rejected: contentByStatus.get("rejected") || 0,
          },
        },
        calendar: { enabled: true, scheduled_cards: scheduledRows.c },
        team_chat: { enabled: true, channels: chatRows.channels, threads: chatRows.threads, messages: chatRows.messages },
        hermes_chat: { enabled: true, note: "AI assistant sidebar — uses rules + memory; external LLM wiring is scaffolded." },
        memory: { enabled: true, notes: memoryRows.c },
        files: { enabled: fileRows.c > 0 || true, total: fileRows.c },
      },
    },
  });
});

export default docs;
