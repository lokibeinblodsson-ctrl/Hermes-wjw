// Hermes AI chat routes: per-user conversations + messages. The actual LLM call
// is scaffolded externally (Hermes assistant). When no external model is wired,
// we fall back to a rule-based responder that uses board context + memory so
// the sidebar is never dead. All data is user-scoped.
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { Env } from "../lib/env";
import { json, jsonError, Errors } from "../lib/errors";
import { resolveSession } from "../db/users";
import { randomId, nowIso, toJson, jsonField } from "../lib/crypto";
import { logAudit } from "../db/logging";

const hermes = new Hono<{ Bindings: Env }>();
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

// Board snapshot for assistant context (live, minimal).
async function boardSnapshot(db: D1DatabaseLike): Promise<{ columns: number; cards: number; byColumn: { name: string; count: number }[] }> {
  const cols = ((await db.prepare(`SELECT name FROM board_columns ORDER BY position ASC`).all()).results as any[]) || [];
  const cards = ((await db.prepare(`SELECT column_id, count(*) as c FROM cards GROUP BY column_id`).all()).results as any[]) || [];
  const byCol = new Map<string, number>();
  for (const r of cards) byCol.set(r.column_id, r.c);
  const colRows = ((await db.prepare(`SELECT id, name FROM board_columns ORDER BY position ASC`).all()).results as any[]) || [];
  const byColumn = colRows.map((c: any) => ({ name: c.name, count: byCol.get(c.id) || 0 }));
  const total = ((await db.prepare(`SELECT count(*) as c FROM cards`).first()) as { c: number }).c;
  return { columns: colRows.length, cards: total, byColumn };
}

const sendSchema = z.object({
  conversation_id: z.string().min(1).optional(),
  message: z.string().min(1).max(8000),
  context: z.object({ board_snapshot: z.boolean().optional().default(true) }).optional(),
});

// Send a message -> get a persisted assistant reply (rule-based fallback).
hermes.post("/chat", zValidator("json", sendSchema), async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  const body = await c.req.json().catch(() => ({}));
  const message: string = body.message;
  let conversationId: string | undefined = body.conversation_id;

  if (!conversationId) {
    conversationId = randomId("hc");
    await c.env.DB.prepare(
      `INSERT INTO hermes_conversations (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
    ).bind(conversationId, user.id, message.slice(0, 60) || "New conversation", nowIso(), nowIso()).run();
  } else {
    const conv = await c.env.DB.prepare(`SELECT id FROM hermes_conversations WHERE id = ? AND user_id = ?`).bind(conversationId, user.id).first();
    if (!conv) return jsonError(Errors.notFound("Conversation not found"));
  }

  // Persist the user message.
  const userMsgId = randomId("hm");
  await c.env.DB.prepare(
    `INSERT INTO hermes_messages (id, conversation_id, role, body, context_json, created_at) VALUES (?, ?, 'user', ?, ?, ?)`
  ).bind(userMsgId, conversationId, message, toJson({}), nowIso()).run();

  // Build context for the responder.
  const snapshot = await boardSnapshot(c.env.DB);
  const memRs = await c.env.DB.prepare(`SELECT title, type FROM memory_notes ORDER BY created_at DESC LIMIT 5`).all();
  const memories = ((memRs.results as any[]) || []).map((m) => ({ title: m.title, type: m.type }));
  const context = { board: snapshot, memories };

  // Assistant reply (rule-based fallback; LLM wiring is a clean swap point).
  const reply = await respond(message, context);

  const asstMsgId = randomId("hm");
  await c.env.DB.prepare(
    `INSERT INTO hermes_messages (id, conversation_id, role, body, context_json, created_at) VALUES (?, ?, 'assistant', ?, ?, ?)`
  ).bind(asstMsgId, conversationId, reply, toJson({ used: "rule-based", board_cards: snapshot.cards }), nowIso()).run();
  await c.env.DB.prepare(`UPDATE hermes_conversations SET updated_at = ? WHERE id = ?`).bind(nowIso(), conversationId).run();
  await logAudit(c.env.DB, { actorId: user.id, action: "hermes_chat", targetType: "hermes_conversation", targetId: conversationId });

  return json({ ok: true, data: { conversation_id: conversationId, reply, context } }, 201);
});

hermes.get("/conversations", async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  const rs = await c.env.DB.prepare(`SELECT * FROM hermes_conversations WHERE user_id = ? ORDER BY updated_at DESC`).bind(user.id).all();
  return json({ ok: true, data: rs.results || [] });
});

hermes.get("/conversations/:id/messages", async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  const id = c.req.param("id");
  const conv = await c.env.DB.prepare(`SELECT id FROM hermes_conversations WHERE id = ? AND user_id = ?`).bind(id, user.id).first();
  if (!conv) return jsonError(Errors.notFound("Conversation not found"));
  const rs = await c.env.DB.prepare(`SELECT * FROM hermes_messages WHERE conversation_id = ? ORDER BY created_at ASC`).bind(id).all();
  const msgs = ((rs.results as any[]) || []).map((m) => ({ ...m, context: jsonField(m.context_json, {}) }));
  return json({ ok: true, data: msgs });
});

// New conversations start fresh.
hermes.post("/conversations", async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  const id = randomId("hc");
  await c.env.DB.prepare(
    `INSERT INTO hermes_conversations (id, user_id, title, created_at, updated_at) VALUES (?, ?, 'New conversation', ?, ?)`
  ).bind(id, user.id, nowIso(), nowIso()).run();
  return json({ ok: true, data: { id } }, 201);
});

hermes.delete("/conversations/:id", async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  const id = c.req.param("id");
  const conv = await c.env.DB.prepare(`SELECT id FROM hermes_conversations WHERE id = ? AND user_id = ?`).bind(id, user.id).first();
  if (!conv) return jsonError(Errors.notFound("Conversation not found"));
  await c.env.DB.prepare(`DELETE FROM hermes_conversations WHERE id = ?`).bind(id).run();
  return json({ ok: true });
});

// ── Rule-based responder (safe fallback; LLM is a clean swap-in) ──
// Understands a few intents and otherwise answers from board context + memory.
async function respond(message: string, ctx: { board: { columns: number; cards: number; byColumn: { name: string; count: number }[] }; memories: { title: string; type: string }[] }): Promise<string> {
  const text = message.toLowerCase();
  const board = ctx.board;

  if (/(how many|count|status of).*(card|board)/.test(text) || text.includes("board status")) {
    const lines = board.byColumn.map((c) => `- ${c.name}: ${c.count}`).join("\n");
    return `The board currently has **${board.cards}** cards across **${board.columns}** columns:\n${lines}`;
  }
  if (text.includes("summarize") || text.includes("what's on the board") || text.includes("overview")) {
    return `Here's the board at a glance:\n- Total cards: ${board.cards}\n- Columns: ${board.columns}\n${board.byColumn.map((c) => `  · ${c.name}: ${c.count}`).join("\n")}\n\n(This is a rule-based responder. Wire an LLM in src/routes/hermes.ts to get full conversational answers.)`;
  }
  if (text.includes("memory") || text.includes("remember")) {
    if (!ctx.memories.length) return "No memory notes are stored yet. Add some from the Memory page and I can reference them.";
    return `I have **${ctx.memories.length}** recent memory note(s):\n` + ctx.memories.map((m) => `- [${m.type}] ${m.title}`).join("\n");
  }
  if (text.includes("help") || text.includes("what can you")) {
    return "I'm the Hermes assistant sidebar. Right now I can:\n- Report board status and counts\n- Summarize what's on the board\n- Recall recent memory notes\n- Take freeform notes you leave here\n\nFull action execution (creating/moving cards) is scaffolded — the LLM swap-in point is `respond()` in src/routes/hermes.ts.";
  }

  // Default: acknowledge + gentle nudge, persist the note.
  return `Got it — I've noted: "${message.slice(0, 200)}".\n\nI'm running in rule-based mode, so I can't fully act on that yet. The integration is scaffolded: connect an LLM in \`src/routes/hermes.ts\` to let me read live board context and execute instructions. In the meantime, your message is saved to this conversation for later.`;
}

export default hermes;
