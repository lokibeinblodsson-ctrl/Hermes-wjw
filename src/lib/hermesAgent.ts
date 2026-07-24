// Client for the self-hosted Hermes agent on deb12, reached through the
// Cloudflare tunnel at https://hermes.wildjazminewellness.ca (→ deb12:8642).
//
// Two uses in WJW:
//   B) Chat brain — src/routes/hermes.ts calls runHermesAgentChat() to get the
//      assistant's conversational reply. Falls back to the free-LLM chain if
//      deb12 is unreachable/unauthorized.
//   A) AI Kanban research — src/routes/aiResearch.ts calls runHermesAgentResearch()
//      as the externalImpl when allow_external_research is on.
//
// The agent API is ASYNC (create session → post message → agent runs in the
// background → poll for the final assistant message). This module wraps that
// into a single await with a hard timeout. Every function returns null on any
// failure so callers degrade safely (never throw into the request path).
//
// SECURITY:
//   - Auth prefers a static bearer token (HERMES_AGENT_TOKEN). If absent, it
//     does password login (HERMES_AGENT_USER / HERMES_AGENT_PASS) and caches
//     the session token for the Worker isolate's lifetime.
//   - The worker only ever SENDS a prompt + reads the reply. It never grants
//     the agent tool/fs/git access from WJW; the system prompt scopes it to
//     answering. The agent cannot mutate WJW data (the WJW action layer stays
//     the only write path, carrying the user's own JWT).
//   - Card/comment/file content passed in is DATA, never instructions (the
//     caller is responsible for that; this client just transports text).
import { Env } from "./env";

const DEFAULT_BASE = "https://hermes.wildjazminewellness.ca";

// Per-isolate token cache (Workers reuse isolates across requests).
let cachedToken: string | null = null;
let tokenFetching: Promise<string | null> | null = null;

export function resetAgentTokenCache(): void {
  cachedToken = null;
  tokenFetching = null;
}

async function fetchToken(env: Env, base: string): Promise<string | null> {
  // 1) Static bearer token (preferred — set via wrangler secret put).
  if (env.HERMES_AGENT_TOKEN && env.HERMES_AGENT_TOKEN.trim()) {
    cachedToken = env.HERMES_AGENT_TOKEN.trim();
    return cachedToken;
  }
  // 2) Password login → session token (also via secrets).
  const user = env.HERMES_AGENT_USER;
  const pass = env.HERMES_AGENT_PASS;
  if (!user || !pass) return null;
  try {
    const res = await fetch(`${base}/api/auth/password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "default", username: user, password: pass }),
    });
    if (!res.ok) return null;
    const d: any = await res.json().catch(() => null);
    const t = d?.token || d?.access_token || d?.session_token || d?.bearer_token || null;
    if (t) cachedToken = t;
    return t;
  } catch {
    return null;
  }
}

async function getAuthHeaders(env: Env, base: string): Promise<Record<string, string> | null> {
  if (!tokenFetching) tokenFetching = fetchToken(env, base);
  const tok = await tokenFetching;
  tokenFetching = null;
  if (!tok) return null;
  return { "content-type": "application/json", authorization: `Bearer ${tok}` };
}

// Defensive body extraction across the agent's possible message shapes.
function msgText(m: any): string {
  if (!m) return "";
  return (m.content ?? m.body ?? m.text ?? m.message ?? "").toString().trim();
}
function msgRole(m: any): string {
  if (!m) return "";
  return (m.role ?? m.author ?? m.sender ?? "").toString().toLowerCase();
}

interface AgentChatResult {
  text: string;
  provider: string;
  model: string;
}

// Run a single conversational turn against deb12. Returns null on any failure.
export async function runHermesAgentChat(
  env: Env,
  messages: { role: string; content: string }[],
  system?: string,
  timeoutMs = 25000
): Promise<AgentChatResult | null> {
  const base = env.HERMES_AGENT_URL || DEFAULT_BASE;
  const headers = await getAuthHeaders(env, base);
  if (!headers) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // 1) Create a session (scoped to "answer the user" — no tool grants from WJW).
    const createRes = await fetch(`${base}/api/sessions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "wjw-assistant", system_prompt: system || "" }),
      signal: ctrl.signal,
    });
    if (!createRes.ok) return null;
    const created: any = await createRes.json().catch(() => null);
    const sessionId = created?.id || created?.session_id || created?.session?.id;
    if (!sessionId) return null;

    // 2) Replay history (if any) then the latest user message.
    const turns = messages.filter((m) => m.role === "user" || m.role === "assistant");
    // The last user message is the actual prompt; earlier turns seed context.
    const lastUser = [...turns].reverse().find((m) => m.role === "user");
    const prompt = lastUser?.content || turns[turns.length - 1]?.content || "";
    for (const t of turns) {
      if (t === lastUser) continue;
      await fetch(`${base}/api/sessions/${sessionId}/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({ role: t.role, content: t.content }),
        signal: ctrl.signal,
      }).catch(() => null);
    }
    const postRes = await fetch(`${base}/api/sessions/${sessionId}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ role: "user", content: prompt }),
      signal: ctrl.signal,
    });
    if (!postRes.ok) return null;

    // 3) Poll for the final assistant message (agent runs async).
    const deadline = Date.now() + timeoutMs - 2000;
    let reply = "";
    while (Date.now() < deadline) {
      const listRes = await fetch(`${base}/api/sessions/${sessionId}/messages`, {
        method: "GET",
        headers,
        signal: ctrl.signal,
      }).catch(() => null);
      if (listRes && listRes.ok) {
        const data: any = await listRes.json().catch(() => null);
        const msgs: any[] = Array.isArray(data) ? data : data?.messages || data?.results || [];
        // Last assistant message that isn't still "pending/running".
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i];
          const role = msgRole(m);
          const status = (m.status || "").toLowerCase();
          if (role === "assistant" && status !== "pending" && status !== "running" && status !== "queued") {
            const t = msgText(m);
            if (t) { reply = t; break; }
          }
        }
        if (reply) break;
        // Also break if the session itself reports a finished/error state.
        const sessState = (data?.state || data?.status || created?.state || "").toLowerCase();
        if (/error|failed|done|completed/.test(sessState) && !reply) {
          // Nothing useful came back; stop polling.
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    return reply ? { text: reply, provider: "hermes-deb12", model: "deb12" } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface AgentResearchSource {
  title: string;
  url: string | null;
  publisher: string | null;
  published_date: string | null;
  relevance: string | null;
  retrieved_at: string;
}

// Ask deb12 to research a topic. Returns sanitized sources (URLs extracted from
// the reply; never fabricates). Returns [] if deb12 is unavailable.
export async function runHermesAgentResearch(
  env: Env,
  query: string,
  questions: string[],
  timeoutMs = 25000
): Promise<AgentResearchSource[]> {
  const prompt =
    `Research the following topic and return concise, factual findings with any ` +
    `source URLs you can cite. Topic: ${query}\nSub-questions:\n` +
    questions.map((q) => `- ${q}`).join("\n");
  const res = await runHermesAgentChat(
    env,
    [{ role: "user", content: prompt }],
    "You are a meticulous research assistant. Cite real URLs only. Do not invent sources.",
    timeoutMs
  );
  if (!res?.text) return [];
  // Extract http(s) URLs mentioned in the answer as citable sources.
  const urls = [...res.text.matchAll(/https?:\/\/[^\s)>"\]]+/g)].map((m) => m[0]);
  const sources: AgentResearchSource[] = urls.map((u) => ({
    title: "Source cited by Hermes research agent",
    url: u,
    publisher: null,
    published_date: null,
    relevance: null,
    retrieved_at: new Date().toISOString(),
  }));
  // Always include the synthesized answer (url null) so the note captures it.
  sources.push({
    title: res.text.slice(0, 2000),
    url: null,
    publisher: "Hermes (deb12)",
    published_date: null,
    relevance: "synthesized answer",
    retrieved_at: new Date().toISOString(),
  });
  return sources;
}
