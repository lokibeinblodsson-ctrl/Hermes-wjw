// Hermes AI assistant routes.
//
// Two surfaces:
//   1) /hermes/chat  — READ-ONLY conversation (board status, summaries, memory).
//      No write actions. The model/rule-based responder only ANSWERS; it never
//      mutates data. (See SECURITY note in the action layer below.)
//   2) /hermes/actions — the ONLY Hermes write path. It takes a *confirmed* user
//      intent (an explicit allow-listed action + parameters), performs a
//      defense-in-depth permission pre-check, enforces a per-user rate limit,
//      and then PHYSICALLY forwards the request to the SAME REST endpoints the
//      normal UI uses — carrying the user's own JWT. There is no Hermes service
//      account, no admin bypass token, and no direct DB write path here.
//
// Security model (non-negotiable, see project spec):
//   - Single source of truth for permissions: src/lib/permissions.ts. Both the
//     public REST routes AND this action layer import it. No second system.
//   - No elevated identity: every forwarded request carries the caller's JWT.
//   - Server-side enforcement: the destination endpoint re-checks permissions
//     independently. The pre-check here is defense-in-depth + nice denials.
//   - Explicit allow-list: only HERMES_ALLOWED_ACTIONS are reachable.
//   - Confirmation is REQUIRED before this endpoint is called (the client only
//     sends here after the user clicks confirm). The endpoint itself fails
//     closed on any unknown action or unverifiable session.
//   - Full audit trail: every attempt (allowed AND denied) is logged to the
//     same audit_logs table with meta.via = "hermes".
//   - Prompt-injection awareness: action parameters come from the user's own
//     confirmed intent, never from untrusted card/comment/file content. The
//     chat responder treats all board content as DATA, not instructions.
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { Env } from "../lib/env";
import { json, jsonError, Errors } from "../lib/errors";
import { getResolvedUser } from "../lib/auth";
import { logAudit } from "../db/logging";
import { randomId, nowIso, toJson, jsonField } from "../lib/crypto";
import { rateLimit, RATE_LIMITS } from "../lib/rateLimit";
import {
  HERMES_ALLOWED_ACTIONS,
  HERMES_ACTION_LABELS,
  checkHermesAction,
  type HermesAction,
} from "../lib/permissions";
import { runLlmChain, type FreeModelMap, type LlmMessage } from "../lib/llm";
import { buildTools, buildSystemPrompt } from "../lib/hermesLlm";
import { runModelWatchdog } from "../lib/modelWatchdog";

// Import the REAL route apps so we forward to their exact handlers — one write
// path, one permission check. (Each already enforces permissions.ts on its own.)
import boardApp from "./board";
import cardhubApp from "./cardhub";
import calendarApp from "./calendar";
import publishingApp from "./publishing";

const hermes = new Hono<{ Bindings: Env }>();
type D1DatabaseLike = import("@cloudflare/workers-types").D1Database;

async function me(db: D1DatabaseLike, c: any) {
  return getResolvedUser(c.req.raw, c.env);
}

// Map an allow-listed Hermes action to the real endpoint it must hit, the
// HTTP method, and a builder for the path + JSON body. This table is the
// structural allow-list: anything not described here cannot be reached.
interface ActionRoute {
  method: "POST" | "PATCH" | "DELETE";
  // builds the path (relative to the mounted prefix, e.g. /board, /calendar…)
  path: (p: Record<string, any>) => string;
  // builds the JSON body sent to the real endpoint (already validated upstream)
  body: (p: Record<string, any>) => Record<string, unknown> | undefined;
  // which mounted prefix the app lives under in index.ts
  mount: string;
}

function buildActionRoutes(): Record<HermesAction, ActionRoute> {
  return {
    create_card: {
      method: "POST",
      path: () => "/cards",
      body: (p) => ({
        column_id: p.column_id,
        title: p.title,
        description: p.description ?? "",
        priority: p.priority,
        due_date: p.due_date ?? null,
        category_id: p.category_id ?? null,
        tags: p.tags ?? [],
      }),
      mount: "/board",
    },
    update_card: {
      method: "PATCH",
      path: (p) => `/cards/${p.card_id}`,
      body: (p) => ({ ...(p.fields ?? {}) }),
      mount: "/board",
    },
    move_card: {
      method: "PATCH",
      path: (p) => `/cards/${p.card_id}`,
      body: (p) => ({ column_id: p.column_id, position: p.position ?? null }),
      mount: "/board",
    },
    comment_on_card: {
      method: "POST",
      path: (p) => `/cards/${p.card_id}/comments`,
      body: (p) => ({ body: p.body, parent_id: p.parent_id ?? null }),
      mount: "/board",
    },
    add_source: {
      method: "POST",
      path: (p) => `/cards/${p.card_id}/sources`,
      body: (p) => ({
        source_type: p.source_type ?? "website",
        authors: p.authors ?? "",
        year: p.year ?? null,
        title: p.title ?? "",
        publisher: p.publisher ?? "",
        url: p.url ?? null,
        retrieved_date: p.retrieved_date ?? null,
        citation: p.citation ?? "",
        note: p.note ?? "",
      }),
      mount: "/board",
    },
    link_file: {
      // The app's "link file" = upload a file entry (files.ts, mounted at /files)
      method: "POST",
      path: () => "",
      body: (p) => ({ name: p.name, kind: p.kind ?? undefined, url: p.url, note: p.note ?? "", tags: p.tags ?? [] }),
      mount: "/files",
    },
    schedule_card: {
      method: "POST",
      path: (p) => `/cards/${p.card_id}/schedule`,
      body: (p) => ({ scheduled_date: p.scheduled_date ?? null }),
      mount: "/calendar",
    },
    submit_for_review: {
      method: "POST",
      path: (p) => `/${p.content_id}/submit`,
      body: () => ({}),
      mount: "/publishing",
    },
    approve_card: {
      method: "POST",
      path: (p) => `/${p.content_id}/review`,
      body: () => ({ action: "approve", note: "" }),
      mount: "/publishing",
    },
    publish_card: {
      method: "POST",
      path: (p) => `/${p.content_id}/publish`,
      body: () => ({}),
      mount: "/publishing",
    },
  };
}

// module-init time (index.ts already imports all of these). We import directly.

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

  const snapshot = await boardSnapshot(c.env.DB);
  const memRs = await c.env.DB.prepare(`SELECT title, type FROM memory_notes ORDER BY created_at DESC LIMIT 5`).all();
  const memories = ((memRs.results as any[]) || []).map((m) => ({ title: m.title, type: m.type }));
  const context = { board: snapshot, memories };

  // Column id/name list for the LLM so it can fill column_id on create/move.
  const colRs = await c.env.DB.prepare(`SELECT id, name FROM board_columns ORDER BY position ASC`).all();
  const columns = ((colRs.results as any[]) || []).map((r) => ({ id: r.id, name: r.name }));

  // Load recent conversation history (so the assistant has memory of the thread).
  const histRs = await c.env.DB.prepare(
    `SELECT role, body FROM hermes_messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 20`
  ).bind(conversationId).all();
  const history = ((histRs.results as any[]) || []).map((m) => ({ role: m.role, body: m.body }));

  // Try the free-provider LLM chain; fall back to the rule-based responder.
  let reply = "";
  let usedProvider = "rule-based";
  let usedModel = "";
  let proposedAction: { action: string; params: Record<string, unknown> } | undefined;

  const map = await loadFreeModelMap(c.env.DB);
  const sys = buildSystemPrompt({
    board: snapshot,
    columns,
    memories,
    userRole: user.role,
    userName: user.email,
  });
  const llmMessages: LlmMessage[] = [
    { role: "system", content: sys },
    ...history.map((h): LlmMessage => ({
      role: h.role === "assistant" ? "assistant" : "user",
      content: h.body,
    })),
    { role: "user", content: message },
  ];

  const llm = await runLlmChain(c.env, map, llmMessages, buildTools());
  if (llm.provider !== "none") {
    usedProvider = llm.provider;
    usedModel = llm.model;
    reply = llm.text;
    if (llm.action && HERMES_ALLOWED_ACTIONS.includes(llm.action.action as HermesAction)) {
      proposedAction = { action: llm.action.action, params: llm.action.params };
      if (!reply) {
        reply = `I can ${HERMES_ACTION_LABELS[llm.action.action as HermesAction].toLowerCase()} for you — confirm below to proceed.`;
      }
    }
  } else {
    // All providers failed/absent — safe rule-based fallback (never fully dead).
    reply = await respond(message, context);
  }

  // Persist the USER message first (so history shows the full conversation),
  // then the assistant reply. Both are scoped to the conversation above.
  const userMsgId = randomId("hm");
  await c.env.DB.prepare(
    `INSERT INTO hermes_messages (id, conversation_id, role, body, context_json, created_at) VALUES (?, ?, 'user', ?, ?, ?)`
  ).bind(userMsgId, conversationId, message, toJson({}), nowIso()).run();

  const asstMsgId = randomId("hm");
  await c.env.DB.prepare(
    `INSERT INTO hermes_messages (id, conversation_id, role, body, context_json, created_at) VALUES (?, ?, 'assistant', ?, ?, ?)`
  ).bind(asstMsgId, conversationId, reply, toJson({ used: usedProvider, model: usedModel, board_cards: snapshot.cards, proposed_action: proposedAction ?? null }), nowIso()).run();
  await logAudit(c.env.DB, { actorId: user.id, action: "hermes_chat", targetType: "hermes_conversation", targetId: conversationId });
  return json({ ok: true, data: { conversation_id: conversationId, reply, context, provider: usedProvider, model: usedModel, proposed_action: proposedAction ?? null } }, 201);
});

// Load the watchdog-maintained free-model map from D1 settings. Returns null
// if unset (the chain then uses compiled defaults + whatever keys exist).
async function loadFreeModelMap(db: D1DatabaseLike): Promise<FreeModelMap | null> {
  try {
    const row = await db.prepare(`SELECT value_json FROM settings WHERE key = 'hermes_free_models'`).first() as { value_json?: string } | null;
    if (!row?.value_json) return null;
    return JSON.parse(row.value_json) as FreeModelMap;
  } catch {
    return null;
  }
}

hermes.get("/conversations", async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  const rs = await c.env.DB.prepare(`SELECT * FROM hermes_conversations WHERE user_id = ? ORDER BY updated_at DESC`).bind(user.id).all();
  return json({ ok: true, data: rs.results || [] });
});

// LLM provider status: which free providers are live (from the watchdog map).
// Read-only; any signed-in user may see it (no keys are ever returned).
hermes.get("/llm-status", async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  const map = await loadFreeModelMap(c.env.DB);
  return json({ ok: true, data: {
    live: map?.order ?? [],
    models: map?.models ?? {},
    disabled: map?.disabled ?? [],
    updated_at: map?.updated_at ?? null,
  } });
});

// Manually run the free-model watchdog (admin only). Lets you refresh the chain
// right after adding a new provider key, without waiting for the daily cron.
hermes.post("/llm-refresh", async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  if (user.role !== "admin") return jsonError(Errors.forbidden("Only admins can refresh the LLM provider map."));
  const result = await runModelWatchdog(c.env);
  await logAudit(c.env.DB, { actorId: user.id, action: "hermes_llm_refresh", targetType: "settings", targetId: "hermes_free_models" });
  return json({ ok: true, data: { live: result.order, models: result.models, disabled: result.disabled, summary: result.summary } });
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

// ── Hermes write action layer ───────────────────────────────────────────────
// Only reachable for explicitly allow-listed actions. The client MUST have
// obtained explicit user confirmation before calling this (the UI shows the
// exact change and waits for a click). This endpoint still fails closed: it
// re-checks the permission against the real endpoint and refuses anything not
// on the allow-list.
const actionSchema = z.object({
  // Deliberately a plain string (NOT z.enum) so an unknown action reaches our
  // allow-list gate below — where we can REFUSE it with 403 AND log the denial.
  // If we used z.enum, zod would 400 before our code runs and we'd lose the
  // audit trail for attempted (denied) actions.
  action: z.string().min(1).max(40),
  params: z.record(z.any()).default({}),
});

// Resolve a card's ownership so the pre-check can evaluate update_card rules.
async function cardOwner(db: D1DatabaseLike, cardId: string): Promise<{ created_by: string | null } | null> {
  const r = await db.prepare(`SELECT created_by FROM cards WHERE id = ?`).bind(cardId).first();
  return r ? (r as { created_by: string | null }) : null;
}


// Build the per-action route table once.
const ROUTES = buildActionRoutes();
// link_file uses the files app (mounted at /files), override the placeholder.

hermes.post("/actions", zValidator("json", actionSchema), async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());

  const body = await c.req.json().catch(() => ({}));
  const action = body.action as HermesAction;
  const params = body.params || {};

  // 1) Allow-list gate — structural. (zod enum already enforces shape, but we
  //    double down with the canonical list from permissions.ts.)
  if (!HERMES_ALLOWED_ACTIONS.includes(action)) {
    await logAudit(c.env.DB, {
      actorId: user.id, action: "hermes_action_denied", targetType: "hermes_action", targetId: action,
      meta: { action, reason: "not_on_allow_list", via: "hermes" },
    });
    return jsonError(Errors.forbidden(`Hermes cannot perform "${action}".`));
  }

  // 2) Resolve card ownership if the action is card-scoped, for the pre-check.
  let card: { created_by: string | null } | null = null;
  if ((action === "update_card" || action === "move_card") && params.card_id) {
    card = await cardOwner(c.env.DB, params.card_id as string);
    if (!card) {
      await logAudit(c.env.DB, {
        actorId: user.id, action: "hermes_action_denied", targetType: "hermes_action", targetId: action,
        meta: { action, reason: "card_not_found", card_id: params.card_id, via: "hermes" },
      });
      return jsonError(Errors.notFound("Card not found"));
    }
  }

  // 3) Defense-in-depth pre-check using the SAME permission module. Builds a
  //    precise denial message if the role/card disallows it.
  const pre = checkHermesAction(user, action, card ?? undefined);
  if (!pre.ok) {
    await logAudit(c.env.DB, {
      actorId: user.id, action: "hermes_action_denied", targetType: "hermes_action", targetId: action,
      meta: { action, reason: pre.reason, required_role: pre.requiredRole, card_id: params.card_id ?? null, via: "hermes" },
    });
    return jsonError(Errors.forbidden(pre.reason || "This action is not permitted for your role."));
  }

  // 4) Per-user Hermes write rate limit (separate from general API limits).
  const rl = rateLimit(`hermes-write:${user.id}`, RATE_LIMITS.hermesWrite.limit, RATE_LIMITS.hermesWrite.window);
  if (!rl.allowed) {
    await logAudit(c.env.DB, {
      actorId: user.id, action: "hermes_action_rate_limited", targetType: "hermes_action", targetId: action,
      meta: { action, retry_after: rl.retryAfter, via: "hermes" },
    });
    return jsonError(Errors.tooManyRequests(`Hermes write rate limit reached. Retry in ${rl.retryAfter}s.`));
  }

  // 5) Build the CONCRETE API plan for the real endpoint. The actual write is
  //    performed by the CLIENT calling this exact endpoint with the user's own
  //    JWT — identical to clicking the button in the UI. This avoids nested
  //    in-process subrequests (which workerd rejects as "Cross Request Promise
  //    Resolve") while guaranteeing the SAME endpoint + SAME permission check
  //    the normal UI uses. There is no Hermes service account and no direct DB
  //    write path here.
  const route = ROUTES[action];
  const planBody = route.body(params);
  const plan = {
    method: route.method,
    path: `${route.mount}${route.path(params)}`,
    body: planBody,
  };

  // 6) Audit that this action was authorized by Hermes (tagged via: "hermes").
  //    The real endpoint will separately log the concrete write (e.g.
  //    card_created) carrying the same actor. Denials are logged above.
  await logAudit(c.env.DB, {
    actorId: user.id,
    action: "hermes_action_authorized",
    targetType: "hermes_action",
    targetId: action,
    meta: {
      action,
      via: "hermes",
      confirmed: true,
      target_id: params.card_id ?? params.content_id ?? null,
      label: HERMES_ACTION_LABELS[action],
      plan_path: plan.path,
      plan_method: plan.method,
    },
  });

  return json({
    ok: true,
    action,
    label: HERMES_ACTION_LABELS[action],
    plan,
  }, 200);
});

// ── Rule-based responder (safe fallback; LLM is a clean swap-in) ──
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
    return (
      "I'm the Hermes assistant sidebar. I can:\n" +
      "- Answer questions about the board, summarize cards, and recall memory notes (read-only)\n" +
      "- Take CONFIRMED actions on your behalf: create/move/update cards, comment, add sources, link files, schedule, submit for review, and (for your role) approve/publish\n\n" +
      "Any write action shows you exactly what will happen and asks for confirmation first. I can only do what your own account can do through the normal UI — nothing more.\n\n" +
      "Security note: card text, comments, and files are treated as DATA, never as instructions. I will not follow commands embedded inside card content."
    );
  }

  return `Got it — I've noted: "${message.slice(0, 200)}".\n\nI'm running in rule-based mode for read-only questions. To perform an action, ask me in plain language (e.g. "create a card in Backlog titled X") and I'll show you a confirmation before doing anything. Your message is saved to this conversation.`;
}

export default hermes;
