// Daily free-model watchdog for the in-app Hermes LLM.
//
// Runs from the Worker cron handler (src/index.ts scheduled()). For each
// provider that has a key set, it probes the current model with a tiny request.
// For OpenRouter it also queries /models to pick a currently-":free" model.
// The result — which providers/models are live + free + reachable, in priority
// order — is written to D1 settings key "hermes_free_models" (a FreeModelMap),
// which src/routes/hermes.ts reads on every chat. If a provider stops working
// or stops being free, it's dropped from the live chain automatically.
import { Env } from "./env";
import { PROVIDERS, probeProvider, type FreeModelMap } from "./llm";
import { nowIso, toJson } from "./crypto";

// Query OpenRouter for a currently-free chat model (id ending in ":free").
// Prefers a small set of known-good instruct models; falls back to the first
// free model returned. Returns null if the key is missing or none are free.
async function pickOpenRouterFreeModel(apiKey: string, timeoutMs = 6000): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const models: any[] = data?.data || [];
    const freeIds: string[] = models
      .map((m) => m?.id as string)
      .filter((id) => typeof id === "string" && id.endsWith(":free"));
    if (!freeIds.length) return null;
    // Preference order (good instruct + tool support when available).
    const prefer = [
      "deepseek/deepseek-chat-v3-0324:free",
      "deepseek/deepseek-r1:free",
      "meta-llama/llama-3.3-70b-instruct:free",
      "qwen/qwen-2.5-72b-instruct:free",
      "google/gemini-2.0-flash-exp:free",
    ];
    for (const p of prefer) if (freeIds.includes(p)) return p;
    return freeIds[0];
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Build and persist the live free-model map. Safe to call from cron; never
// throws (logs into the returned summary instead).
export async function runModelWatchdog(env: Env): Promise<FreeModelMap & { summary: string[] }> {
  const summary: string[] = [];
  const order: string[] = [];
  const models: Record<string, string> = {};
  const disabled: string[] = [];

  for (const spec of PROVIDERS) {
    const key = env[spec.keyEnv];
    if (!key || typeof key !== "string" || !key.trim()) {
      summary.push(`${spec.id}: no key set — skipped`);
      continue;
    }
    // Choose which model to probe.
    let model = spec.defaultModel;
    if (spec.id === "openrouter") {
      const picked = await pickOpenRouterFreeModel(key);
      if (picked) { model = picked; summary.push(`openrouter: free model = ${picked}`); }
      else { summary.push("openrouter: no :free model available — disabled"); disabled.push(spec.id); continue; }
    }
    const ok = await probeProvider(env, spec, model);
    if (ok) {
      order.push(spec.id);
      models[spec.id] = model;
      summary.push(`${spec.id}: OK (${model})`);
    } else {
      disabled.push(spec.id);
      summary.push(`${spec.id}: probe FAILED (${model}) — disabled`);
    }
  }

  const map: FreeModelMap = { updated_at: nowIso(), order, models, disabled };
  try {
    await env.DB.prepare(
      `INSERT INTO settings (key, value_json, updated_at, updated_by) VALUES ('hermes_free_models', ?, ?, 'watchdog')
       ON CONFLICT(key) DO UPDATE SET value_json = ?, updated_at = ?, updated_by = 'watchdog'`
    ).bind(toJson(map), nowIso(), toJson(map), nowIso()).run();
    summary.push(`persisted: ${order.length} live provider(s): ${order.join(", ") || "none"}`);
  } catch (e: any) {
    summary.push(`persist FAILED: ${e?.message || e}`);
  }
  return { ...map, summary };
}
