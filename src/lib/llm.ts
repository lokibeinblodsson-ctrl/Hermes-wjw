// Multi-provider LLM layer for the in-app Hermes assistant.
//
// Design goals:
//   - FREE providers only. Each is OpenAI-chat-completions compatible, so a
//     single adapter drives all of them (different base URL + key + model).
//   - PRIORITISED FALLBACK CHAIN: try provider 1, on failure/timeout/limit fall
//     through to the next. If ALL fail, the caller drops to the rule-based
//     responder, so Hermes is never fully dead.
//   - LIVE MODEL MAP: which model to use per provider is read from the D1
//     `settings` table (key = "hermes_free_models"), maintained by the daily
//     watchdog (src/lib/modelWatchdog.ts). Falls back to compiled defaults.
//   - TOOL CALLING: the unified tool schema mirrors HERMES_ALLOWED_ACTIONS so
//     the model can PROPOSE an action. The proposal still flows through the
//     client confirm -> /hermes/actions path (permissions + audit unchanged).
//   - Only providers whose API key secret exists are attempted.
//
// Security: card/comment/file content is passed as DATA in the context block,
// never as system instructions. The system prompt hard-codes the injection
// guard. This module NEVER performs writes — it only returns text and/or a
// proposed (unconfirmed) action.
import { Env } from "./env";

export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  name?: string;
}

// A tool the model may call. Mirrors the OpenAI function-tool shape.
export interface LlmTool {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

// A proposed action the model wants to take (NOT yet executed/confirmed).
export interface ProposedAction {
  action: string;
  params: Record<string, unknown>;
}

export interface LlmResult {
  text: string;
  provider: string;      // which provider answered (or "none")
  model: string;         // which model answered
  action?: ProposedAction; // present if the model called a tool
}

// ── Provider registry ───────────────────────────────────────────────────────
// Each provider is OpenAI-compatible. `keyEnv` is the Env field holding its
// secret; `defaultModel` is used when the live map has no entry. Order here is
// the DEFAULT priority; the live map may override the order + models.
interface ProviderSpec {
  id: string;
  baseUrl: string;
  keyEnv: keyof Env;
  defaultModel: string;
  supportsTools: boolean;
}

const PROVIDERS: ProviderSpec[] = [
  // Google Gemini via its OpenAI-compatible endpoint. Generous free tier, fast,
  // strong tool-calling. AI Studio key (free): https://aistudio.google.com/apikey
  {
    id: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    keyEnv: "GEMINI_API_KEY",
    defaultModel: "gemini-2.0-flash",
    supportsTools: true,
  },
  // Groq — free, extremely fast Llama. https://console.groq.com/keys
  {
    id: "groq",
    baseUrl: "https://api.groq.com/openai/v1/chat/completions",
    keyEnv: "GROQ_API_KEY",
    defaultModel: "llama-3.3-70b-versatile",
    supportsTools: true,
  },
  // OpenRouter — many :free models, itself a multi-upstream router.
  // https://openrouter.ai/keys
  {
    id: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1/chat/completions",
    keyEnv: "OPENROUTER_API_KEY",
    defaultModel: "deepseek/deepseek-chat-v3-0324:free",
    supportsTools: true,
  },
  // Cerebras — free tier, very fast Llama. https://cloud.cerebras.ai
  {
    id: "cerebras",
    baseUrl: "https://api.cerebras.ai/v1/chat/completions",
    keyEnv: "CEREBRAS_API_KEY",
    defaultModel: "llama-3.3-70b",
    supportsTools: true,
  },
  // Mistral La Plateforme — free tier. https://console.mistral.ai
  {
    id: "mistral",
    baseUrl: "https://api.mistral.ai/v1/chat/completions",
    keyEnv: "MISTRAL_API_KEY",
    defaultModel: "mistral-small-latest",
    supportsTools: true,
  },
];

export const PROVIDER_IDS = PROVIDERS.map((p) => p.id);

// Shape of the live model map stored in D1 settings (key "hermes_free_models").
// Written by the watchdog. `order` overrides priority; `models` overrides the
// per-provider model; `disabled` drops a provider that stopped being free.
export interface FreeModelMap {
  updated_at?: string;
  order?: string[];                 // provider ids, highest priority first
  models?: Record<string, string>;  // provider id -> model id
  disabled?: string[];              // provider ids to skip
}

// Resolve the effective, ordered list of usable providers: has a key, not
// disabled, ordered by the live map (if present) then default order.
export function resolveChain(env: Env, map: FreeModelMap | null): { spec: ProviderSpec; model: string }[] {
  const disabled = new Set(map?.disabled ?? []);
  const order = map?.order && map.order.length ? map.order : PROVIDERS.map((p) => p.id);
  const byId = new Map(PROVIDERS.map((p) => [p.id, p]));
  const chain: { spec: ProviderSpec; model: string }[] = [];
  for (const id of order) {
    const spec = byId.get(id);
    if (!spec) continue;
    if (disabled.has(id)) continue;
    const key = env[spec.keyEnv];
    if (!key || typeof key !== "string" || !key.trim()) continue; // no secret -> skip
    const model = map?.models?.[id] || spec.defaultModel;
    chain.push({ spec, model });
  }
  return chain;
}

// One OpenAI-compatible chat call with a hard timeout. Returns text + optional
// tool call, or throws on any error (so the chain falls through).
async function callProvider(
  spec: ProviderSpec,
  model: string,
  apiKey: string,
  messages: LlmMessage[],
  tools: LlmTool[] | undefined,
  timeoutMs: number
): Promise<{ text: string; action?: ProposedAction }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const payload: Record<string, unknown> = {
      model,
      messages,
      temperature: 0.4,
      max_tokens: 1024,
    };
    if (tools && tools.length && spec.supportsTools) {
      payload.tools = tools;
      payload.tool_choice = "auto";
    }
    const headers: Record<string, string> = {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    };
    // OpenRouter appreciates attribution headers (optional, harmless elsewhere).
    if (spec.id === "openrouter") {
      headers["HTTP-Referer"] = "https://app.wildjazminewellness.ca";
      headers["X-Title"] = "Wild Jazmine Wellness";
    }
    const res = await fetch(spec.baseUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`${spec.id} HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const data: any = await res.json();
    const choice = data?.choices?.[0];
    const msg = choice?.message;
    let action: ProposedAction | undefined;
    const tc = msg?.tool_calls?.[0];
    if (tc?.function?.name) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(tc.function.arguments || "{}"); } catch { /* ignore */ }
      action = { action: tc.function.name, params: args };
    }
    const text = (msg?.content || "").trim();
    if (!text && !action) throw new Error(`${spec.id} returned empty response`);
    return { text, action };
  } finally {
    clearTimeout(timer);
  }
}

// Run the fallback chain. Returns the first success, or a result with
// provider="none" if every provider failed (caller then uses rule-based).
export async function runLlmChain(
  env: Env,
  map: FreeModelMap | null,
  messages: LlmMessage[],
  tools?: LlmTool[],
  perCallTimeoutMs = 8000
): Promise<LlmResult> {
  const chain = resolveChain(env, map);
  const errors: string[] = [];
  for (const { spec, model } of chain) {
    const apiKey = env[spec.keyEnv] as string;
    try {
      const { text, action } = await callProvider(spec, model, apiKey, messages, tools, perCallTimeoutMs);
      return { text, action, provider: spec.id, model };
    } catch (e: any) {
      errors.push(e?.message || String(e));
      // fall through to next provider
    }
  }
  return { text: "", provider: "none", model: "", };
}

// A single cheap probe used by the watchdog to verify a provider+model works.
// Returns true if the provider answered "ok" (or anything non-empty).
export async function probeProvider(
  env: Env,
  spec: ProviderSpec,
  model: string,
  timeoutMs = 6000
): Promise<boolean> {
  const apiKey = env[spec.keyEnv];
  if (!apiKey || typeof apiKey !== "string") return false;
  try {
    const { text } = await callProvider(
      spec, model, apiKey,
      [{ role: "user", content: "Reply with the single word: ok" }],
      undefined, timeoutMs
    );
    return !!text;
  } catch {
    return false;
  }
}

export { PROVIDERS };
export type { ProviderSpec };
