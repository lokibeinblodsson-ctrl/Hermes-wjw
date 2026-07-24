// AI Kanban research routes + job runner.
//
// Endpoints (all under /api/v1/ai-research):
//   POST /cards/:id/research        enqueue (trigger: created|moved|manual)
//   POST /cards/:id/research/rerun  force a fresh run (new content hash)
//   DELETE /cards/:id/research/run/:runId   cancel an active run
//   GET  /cards/:id/research        status + latest note + sources + runs
//   GET  /cards/:id/research/sources
//   POST /cards/:id/research/tags/:tagId/approve   | /reject
//   POST /cards/:id/research/links/:linkId/approve | /reject
//   GET  /research/search?q=        internal knowledge search (authorized)
//
// Authorization: any active user may request research on a card they can see;
// approving/rejecting tags+links requires edit rights on the card
// (canEditCard). The job itself only READS authorized content and writes AI
// rows scoped to the card. No cross-tenant access is possible (single tenant,
// card_id FK + created_by everywhere).
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { Env } from "../lib/env";
import { json, jsonError, Errors } from "../lib/errors";
import { getResolvedUser } from "../lib/auth";
import { canEditCard } from "../lib/permissions";
import { logAudit } from "../db/logging";
import { randomId, nowIso, toJson, jsonField } from "../lib/crypto";
import { first, all } from "../db/db";
import {
  createRun, setRunStatus, activeRunForCard, runByHash,
  createResearchNote, latestResearchNote, insertSources, getSources,
  upsertTag, listTags, listAliases, setCardTag, syncNoteAppliedTags,
  upsertLink, listCardLinks, getResearchConfig,
} from "../db/aiResearch";
import {
  validateIntake, normalizeTag, consolidateTags, buildAliasMap,
  scoreLink, dedupeLinks, decideLinkStatus, cardContentHash,
} from "../lib/aiResearch/intake";
import { makeInternalRetrieval, makeExternalResearch, internalRetrievalProvider } from "../lib/aiResearch/researchProvider";
import { computeEmbedding, cosineSimilarity } from "../lib/memory/embeddings";
import { safeJson } from "../lib/aiResearch/safeJson";

const ai = new Hono<{ Bindings: Env }>();
type D1DatabaseLike = import("@cloudflare/workers-types").D1Database;

async function me(db: D1DatabaseLike, c: any) {
  return getResolvedUser(c.req.raw, c.env);
}

// Default thresholds/limits. Overridable per config via config_json.
const DEFAULTS = {
  tagConfidenceThreshold: 0.6,
  linkConfidenceThreshold: 0.6,
  maxAiTagsPerCard: 8,
  minExistingTagUsage: 2,
  autoApplyHighConfidenceExisting: true,
  requireReviewForNewTags: true,
  internalThreshold: 0.25,
};

// ── Enqueue ─────────────────────────────────────────────────────────────────
ai.post("/cards/:id/research", zValidator("json", z.object({ trigger: z.enum(["created", "moved", "manual"]).default("manual"), force: z.boolean().default(false) }).optional().default({})), async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  const cardId = c.req.param("id");
  const card = await first<any>(c.env.DB, `SELECT id, title, description, tags_json, notes FROM cards WHERE id = ?`, [cardId]);
  if (!card) return jsonError(Errors.notFound("Card not found"));

  const body = await c.req.json().catch(() => ({}));
  const cfg = await getResearchConfig(c.env.DB, "workspace", null);
  const enabled = cfg ? !!cfg.enabled : false;
  if (!enabled && body.trigger !== "manual" && !body.force) {
    return jsonError(Errors.badRequest("AI research is disabled for this workspace"));
  }
  const hash = cardContentHash(card);
  // Idempotency: skip if an identical-content run already completed (unless force).
  if (!body.force) {
    const prior = await runByHash(c.env.DB, cardId, hash);
    if (prior && (prior.status === "completed" || prior.status === "running" || prior.status === "queued")) {
      return json({ ok: true, data: { skipped: true, reason: "already_processed", run_id: prior.id, status: prior.status } });
    }
  }
  if (await activeRunForCard(c.env.DB, cardId)) {
    return jsonError(Errors.conflict("A research run is already active for this card"));
  }
  const runId = await createRun(c.env.DB, cardId, body.trigger || "manual", hash, {}, cfg?.config_json ? safeJson(cfg.config_json, {}) : {}, user.id);
  // Run synchronously (no queue in WJW yet; structured so a queue could call
  // runResearch later). Status transitions: queued -> running -> completed/...
  const result = await runResearch(c.env.DB, { runId, cardId, card, user, cfg, externalImpl: undefined });
  return json({ ok: true, data: result }, 201);
});

ai.post("/cards/:id/research/rerun", async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  const cardId = c.req.param("id");
  const card = await first<any>(c.env.DB, `SELECT id, title, description, tags_json, notes FROM cards WHERE id = ?`, [cardId]);
  if (!card) return jsonError(Errors.notFound("Card not found"));
  const cfg = await getResearchConfig(c.env.DB, "workspace", null);
  if (await activeRunForCard(c.env.DB, cardId)) return jsonError(Errors.conflict("A research run is already active for this card"));
  const runId = await createRun(c.env.DB, cardId, "rerun", cardContentHash(card), {}, cfg?.config_json ? safeJson(cfg.config_json, {}) : {}, user.id);
  const result = await runResearch(c.env.DB, { runId, cardId, card, user, cfg, externalImpl: undefined });
  return json({ ok: true, data: result }, 201);
});

ai.delete("/cards/:id/research/run/:runId", async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  const { id, runId } = c.req.param() as { id: string; runId: string };
  const run = await first<any>(c.env.DB, `SELECT id, status, created_by FROM card_ai_runs WHERE id = ? AND card_id = ?`, [runId, id]);
  if (!run) return jsonError(Errors.notFound("Run not found"));
  if (run.status === "completed" || run.status === "failed") return jsonError(Errors.badRequest("Run already finished"));
  await setRunStatus(c.env.DB, runId, "cancelled");
  await logAudit(c.env.DB, { actorId: user.id, action: "ai_research_cancelled", targetType: "card", targetId: id, meta: { run_id: runId } });
  return json({ ok: true });
});

// ── Read ──────────────────────────────────────────────────────────────────
ai.get("/cards/:id/research", async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  const cardId = c.req.param("id");
  const card = await first<any>(c.env.DB, `SELECT id FROM cards WHERE id = ?`, [cardId]);
  if (!card) return jsonError(Errors.notFound("Card not found"));
  const runs = await all<any>(c.env.DB, `SELECT id, trigger, status, content_hash, error, created_at, updated_at, completed_at FROM card_ai_runs WHERE card_id = ? ORDER BY created_at DESC`, [cardId]);
  const note = await latestResearchNote(c.env.DB, cardId);
  let sources: any[] = [];
  if (note) sources = await getSources(c.env.DB, note.id);
  const links = await listCardLinks(c.env.DB, cardId);
  return json({
    ok: true,
    data: {
      runs,
      research: note
        ? { ...note, content: safeJson(note.content_json, {}), sources: sources.map((s) => ({ ...s, url: s.url })), applied_tags: safeJson(note.applied_tags_json, []), proposed_tags: safeJson(note.proposed_tags_json, []), proposed_links: safeJson(note.proposed_links_json, []) }
        : null,
      links,
    },
  });
});

ai.get("/cards/:id/research/sources", async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  const cardId = c.req.param("id");
  const note = await latestResearchNote(c.env.DB, cardId);
  if (!note) return json({ ok: true, data: [] });
  return json({ ok: true, data: await getSources(c.env.DB, note.id) });
});

// ── Approve / reject AI suggestions (requires card edit rights) ──────────────
async function requireCardEditor(c: any, cardId: string) {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  const card = await first<any>(c.env.DB, `SELECT id, created_by FROM cards WHERE id = ?`, [cardId]);
  if (!card) return jsonError(Errors.notFound("Card not found"));
  if (!canEditCard(user, card.created_by)) return jsonError(Errors.forbidden("You may not edit this card"));
  return null; // authorized
}

ai.post("/cards/:id/research/tags/:tagId/approve", async (c) => {
  const denied = await requireCardEditor(c, c.req.param("id"));
  if (denied) return denied;
  const { id, tagId } = c.req.param() as { id: string; tagId: string };
  await c.env.DB.prepare(`UPDATE card_tags SET status = 'active' WHERE card_id = ? AND tag_id = ?`).bind(id, tagId).run();
  await syncNoteAppliedTags(c.env.DB, id);
  await logAudit(c.env.DB, { actorId: (await me(c.env.DB, c))!.id, action: "ai_tag_approved", targetType: "card", targetId: id, meta: { tag_id: tagId } });
  return json({ ok: true });
});
ai.post("/cards/:id/research/tags/:tagId/reject", async (c) => {
  const denied = await requireCardEditor(c, c.req.param("id"));
  if (denied) return denied;
  const { id, tagId } = c.req.param() as { id: string; tagId: string };
  await c.env.DB.prepare(`UPDATE card_tags SET status = 'rejected' WHERE card_id = ? AND tag_id = ?`).bind(id, tagId).run();
  await syncNoteAppliedTags(c.env.DB, id);
  await logAudit(c.env.DB, { actorId: (await me(c.env.DB, c))!.id, action: "ai_tag_rejected", targetType: "card", targetId: id, meta: { tag_id: tagId } });
  return json({ ok: true });
});
ai.post("/cards/:id/research/links/:linkId/approve", async (c) => {
  const denied = await requireCardEditor(c, c.req.param("id"));
  if (denied) return denied;
  const { id, linkId } = c.req.param() as { id: string; linkId: string };
  await c.env.DB.prepare(`UPDATE card_ai_links SET status = 'active' WHERE id = ? AND (source_card_id = ? OR target_card_id = ?)`).bind(linkId, id, id).run();
  await logAudit(c.env.DB, { actorId: (await me(c.env.DB, c))!.id, action: "ai_link_approved", targetType: "card", targetId: id, meta: { link_id: linkId } });
  return json({ ok: true });
});
ai.post("/cards/:id/research/links/:linkId/reject", async (c) => {
  const denied = await requireCardEditor(c, c.req.param("id"));
  if (denied) return denied;
  const { id, linkId } = c.req.param() as { id: string; linkId: string };
  await c.env.DB.prepare(`UPDATE card_ai_links SET status = 'rejected' WHERE id = ? AND (source_card_id = ? OR target_card_id = ?)`).bind(linkId, id, id).run();
  await logAudit(c.env.DB, { actorId: (await me(c.env.DB, c))!.id, action: "ai_link_rejected", targetType: "card", targetId: id, meta: { link_id: linkId } });
  return json({ ok: true });
});

// ── Internal knowledge search (reads only authorized, visible content) ──────
ai.get("/research/search", async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  const q = new URL(c.req.url).searchParams.get("q") || "";
  if (q.length < 2) return json({ ok: true, data: [] });
  const hits = await internalRetrievalProvider(c.env.DB, q, 10, DEFAULTS.internalThreshold);
  return json({ ok: true, data: hits });
});

// ── Config (admin only) ──────────────────────────────────────────────────────
ai.get("/config", async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  if (user.role !== "admin") return jsonError(Errors.forbidden());
  const cfg = await getResearchConfig(c.env.DB, "workspace", null);
  return json({ ok: true, data: cfg || { enabled: false, allow_external_research: false, config_json: {} } });
});

const configSchema = z.object({
  enabled: z.boolean().optional(),
  allow_external_research: z.boolean().optional(),
  intake_column_id: z.string().nullable().optional(),
  post_research_column_id: z.string().nullable().optional(),
  config_json: z.record(z.any()).optional(),
});
ai.put("/config", zValidator("json", configSchema), async (c) => {
  const user = await me(c.env.DB, c);
  if (!user) return jsonError(Errors.unauthorized());
  if (user.role !== "admin") return jsonError(Errors.forbidden());
  const body = await c.req.json();
  const existing = await getResearchConfig(c.env.DB, "workspace", null);
  const id = existing?.id || "workspace";
  const enabled = body.enabled ?? existing?.enabled ?? 0;
  const allowExt = body.allow_external_research ?? existing?.allow_external_research ?? 0;
  const intakeCol = "intake_column_id" in body ? (body.intake_column_id ?? null) : existing?.intake_column_id ?? null;
  const postCol = "post_research_column_id" in body ? (body.post_research_column_id ?? null) : existing?.post_research_column_id ?? null;
  const cfgJson = body.config_json !== undefined ? toJson(body.config_json) : (existing?.config_json ?? "{}");
  await c.env.DB.prepare(
    `INSERT INTO ai_research_config (id, scope, scope_id, enabled, allow_external_research, intake_column_id, post_research_column_id, config_json, updated_by, updated_at, created_at)
     VALUES (?, 'workspace', NULL, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       enabled = excluded.enabled,
       allow_external_research = excluded.allow_external_research,
       intake_column_id = excluded.intake_column_id,
       post_research_column_id = excluded.post_research_column_id,
       config_json = excluded.config_json,
       updated_by = excluded.updated_by,
       updated_at = excluded.updated_at`
  ).bind(id, enabled, allowExt, intakeCol, postCol, cfgJson, user.id, nowIso(), nowIso()).run();
  await logAudit(c.env.DB, { actorId: user.id, action: "ai_research_config_updated", targetType: "setting", targetId: "ai_research_config", meta: body });
  const cfg = await getResearchConfig(c.env.DB, "workspace", null);
  return json({ ok: true, data: cfg });
});
// ── Trigger helper (called from board create/move) ──────────────────────────
// Called after a card is created or moved into a configured intake column.
// Honors: enabled flag, no active run, idempotency by content hash, and only
// fires for cards in the configured intake column. Runs best-effort and never
// blocks the user's write. Returns the run id or null (skipped).
export async function maybeTriggerResearch(
  db: D1DatabaseLike,
  opts: { cardId: string; card: any; user: { id: string; role: string }; trigger: "created" | "moved" }
): Promise<string | null> {
  const cfg = await getResearchConfig(db, "workspace", null);
  if (!cfg || !cfg.enabled) return null;
  const intakeCol = cfg.intake_column_id;
  // Auto-research fires only for cards in the configured intake column,
  // whether they were just created there or moved there.
  const inIntake = !!intakeCol && opts.card.column_id === intakeCol;
  if (!inIntake) return null;
  const hash = cardContentHash(opts.card);
  const prior = await runByHash(db, opts.cardId, hash);
  if (prior && (prior.status === "completed" || prior.status === "queued" || prior.status === "running")) return null;
  if (await activeRunForCard(db, opts.cardId)) return null;
  const runId = await createRun(db, opts.cardId, opts.trigger, hash, {}, cfg.config_json ? safeJson(cfg.config_json, {}) : {}, opts.user.id);
  // Run the research to completion before returning. The research path is
  // fully local/deterministic (no external LLM in this environment) so it
  // finishes quickly; awaiting here keeps the run atomic and prevents the
  // Workers runtime from cancelling the detached promise once the Response is
  // returned (which previously left runs stuck in `running`). Errors are
  // swallowed so a card write never fails because research did.
  await runResearch(db, { runId, cardId: opts.cardId, card: opts.card, user: opts.user, cfg, externalImpl: undefined }).catch((e) => {
    console.error("[research] run failed", e?.message || e);
  });
  return runId;
}

export default ai;

export interface RunContext {
  runId: string;
  cardId: string;
  card: any;
  user: { id: string; role: string };
  cfg: any;
  externalImpl?: (query: string, questions: string[]) => Promise<any[]>;
}

export async function runResearch(db: D1DatabaseLike, ctx: RunContext): Promise<{ run_id: string; status: string; note_id?: string }> {
  await setRunStatus(db, ctx.runId, "running");
  const cfgJson = ctx.cfg?.config_json ? safeJson(ctx.cfg.config_json, {}) : {};
  const settings = { ...DEFAULTS, ...cfgJson };
  try {
    // 1) Intake — in this environment the model call is optional. We build a
    //    deterministic intake from the card (title/desc/tags) and validate it
    //    the same way model output would be validated. A real provider would
    //    replace this with validateIntake(modelOutput).
    const rawIntake = {
      topic_summary: ctx.card.description ? ctx.card.description.slice(0, 500) : ctx.card.title,
      primary_topic: ctx.card.title,
      entities: safeJson(ctx.card.tags_json, []),
      intent: deriveIntent(ctx.card),
      initial_tags: safeJson(ctx.card.tags_json, []),
      research_questions: buildQuestions(ctx.card),
    };
    const intake = validateIntake(rawIntake);
    if (!intake.ok) {
      await setRunStatus(db, ctx.runId, "failed", intake.error);
      return { run_id: ctx.runId, status: "failed" };
    }

    // 2) Research (internal always; external gated)
    const internal = await internalRetrievalProvider(db, intake.data.topic_summary || ctx.card.title, 10, settings.internalThreshold);
    const external = await makeExternalResearch(ctx.externalImpl)(ctx.card.title, intake.data.research_questions, !!ctx.cfg?.allow_external_research);

    // 3) Tag consolidation + taxonomy
    const aliasMap = buildAliasMap(await listAliases(db));
    const { canonical, rejected } = consolidateTags(intake.data.initial_tags.concat(internal.flatMap((h) => h.matchingTags)), aliasMap);
    const tagIds: { tagId: string; proposed: boolean }[] = [];
    for (const name of canonical.slice(0, settings.maxAiTagsPerCard)) {
      const existing = await first<any>(db, `SELECT id, usage_count FROM tags WHERE name = ?`, [name]);
      const isExisting = !!existing && existing.usage_count >= settings.minExistingTagUsage;
      const highConf = isExisting && settings.autoApplyHighConfidenceExisting;
      const tagId = await upsertTag(db, name, "ai", ctx.user.id);
      const proposed = settings.requireReviewForNewTags && !isExisting;
      // Apply (write card_tags) only when auto-apply allowed; else leave proposed.
      await setCardTag(db, ctx.cardId, tagId, "ai", highConf ? 0.9 : 0.5, highConf ? "active" : "proposed", ctx.user.id);
      tagIds.push({ tagId, proposed });
    }

    // 4) Related-card links via shared tags/entities/semantic similarity
    const otherCards = (await all<any>(db, `SELECT id, title, description, tags_json FROM cards WHERE id <> ?`, [ctx.cardId])) as any[];
    const baseTags = new Set(safeJson(ctx.card.tags_json, []).map((t: string) => normalizeTag(t)));
    const candidates = [];
    for (const oc of otherCards) {
      const ocTags = new Set(safeJson(oc.tags_json, []).map((t: string) => normalizeTag(t)));
      let sharedTags = 0;
      baseTags.forEach((t) => { if (ocTags.has(t)) sharedTags++; });
      const sim = cosineSimilarity(computeEmbedding(ctx.card.title + " " + (ctx.card.description || "")), computeEmbedding(oc.title + " " + (oc.description || "")));
      const conf = scoreLink({ sharedTags, sharedEntities: 0, similarity: sim });
      if (conf >= 0.2) {
        candidates.push({
          source_card_id: ctx.cardId, target_card_id: oc.id,
          relationship_type: "related_to" as const,
          confidence: conf, explanation: `Semantic similarity ${(sim * 100) | 0}%${sharedTags ? `; ${sharedTags} shared tag(s)` : ""}`,
          evidence: [`similarity=${sim.toFixed(2)}`, `sharedTags=${sharedTags}`],
        });
      }
    }
    const deduped = dedupeLinks(candidates);
    const rejectedKeys = new Set<string>(); // populated from prior rejections in real use
    for (const link of deduped.slice(0, 10)) {
      const status = decideLinkStatus(link.confidence, settings.linkConfidenceThreshold, rejectedKeys);
      await upsertLink(db, { ...link, source: "ai", status, createdBy: ctx.user.id });
    }

    // 5) Persist the structured research note + sources
    const content = {
      topic_summary: intake.data.topic_summary,
      primary_topic: intake.data.primary_topic,
      intent: intake.data.intent,
      executive_summary: `Auto-research for "${ctx.card.title}". Found ${internal.length} internal and ${external.length} external source(s).`,
      key_insights: internal.slice(0, 5).map((h) => h.rationale),
      research_questions: intake.data.research_questions,
      confidence: intake.data.confidence,
      open_questions: intake.data.clarification_questions,
      assumptions: ["No external provider configured in this environment; external research skipped."],
    };
    const noteId = await createResearchNote(
      db, ctx.cardId, ctx.runId, 1, content, external,
      tagIds.filter((t) => !t.proposed).map((t) => t.tagId),
      tagIds.filter((t) => t.proposed).map((t) => t.tagId),
      deduped.map((l) => l.target_card_id),
      ctx.user.id
    );
    await insertSources(db, noteId, external.map((s) => ({ ...s, retrieved_at: nowIso() })));

    // 6) Optional post-research auto-move
    if (ctx.cfg?.post_research_column_id) {
      await db.prepare(`UPDATE cards SET column_id = ?, updated_at = ? WHERE id = ?`).bind(ctx.cfg.post_research_column_id, nowIso(), ctx.cardId).run();
    }

    await setRunStatus(db, ctx.runId, "completed");
    await logAudit(db, { actorId: ctx.user.id, action: "ai_research_completed", targetType: "card", targetId: ctx.cardId, meta: { run_id: ctx.runId, sources_internal: internal.length, sources_external: external.length, tags: tagIds.length, links: deduped.length } });
    return { run_id: ctx.runId, status: "completed", note_id: noteId };
  } catch (e: any) {
    await setRunStatus(db, ctx.runId, "failed", e?.message || "research failed");
    return { run_id: ctx.runId, status: "failed" };
  }
}

function deriveIntent(card: any): string {
  const t = (card.title + " " + (card.description || "")).toLowerCase();
  if (t.includes("bug") || t.includes("broken") || t.includes("fix")) return "bug";
  if (t.includes("implement") || t.includes("build") || t.includes("add")) return "implementation";
  if (t.includes("decide") || t.includes("choose") || t.includes("vs")) return "decision";
  if (t.includes("plan") || t.includes("schedule") || t.includes("roadmap")) return "planning";
  if (t.includes("?") || t.includes("how") || t.includes("what")) return "inquiry";
  if (t.includes("research") || t.includes("investigate") || t.includes("study")) return "research";
  return "other";
}

function buildQuestions(card: any): string[] {
  const base = card.title;
  return [
    `What are the key requirements for "${base}"?`,
    `What options or approaches exist for "${base}"?`,
    `What risks or pitfalls should be considered for "${base}"?`,
  ].slice(0, 6);
}
