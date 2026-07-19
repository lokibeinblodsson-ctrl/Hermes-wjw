// Talks to the real Hermes assistant via the host app's API (POST /hermes/chat).
// Falls back to a calm offline responder if the API is unreachable, so the
// chat never feels dead. Mirrors the behavior of the host HermesChatDock.
import { api } from "../lib/api";

interface HermesResult {
  reply: string;
  conversationId: string;
  ok: boolean;
  offline?: boolean;
}

// A lightweight read-only fallback when the assistant API is unavailable.
// Keeps the experience alive without pretending to be the server.
function offlineResponder(message: string): string {
  const t = message.toLowerCase();
  if (/(how many|count|status of).*(card|board)|board status/.test(t))
    return "I'm running offline right now, so I can't read the live board. Reconnect and I'll pull the real numbers.";
  if (t.includes("help") || t.includes("what can you"))
    return "I'm the Hermes assistant. When online I can answer questions about the board, summarize cards, and (with your confirmation) take actions like creating or moving cards. I'm currently in offline mode.";
  if (t.startsWith("create") || t.startsWith("move") || t.startsWith("schedule"))
    return "I'd love to help with that, but I'm offline at the moment. Come back online and I'll show a confirmation before doing anything.";
  return "I'm in offline mode right now, so I can't reach the assistant service. Your message is saved here — try again when the connection is back.";
}

export async function askHermes(
  message: string,
  conversationId?: string
): Promise<HermesResult> {
  try {
    const r = await api.post("/hermes/chat", {
      conversation_id: conversationId || undefined,
      message,
    });
    return {
      reply: r.data?.reply ?? "(no response)",
      conversationId: r.data?.conversation_id ?? conversationId ?? "",
      ok: true,
    };
  } catch {
    return {
      reply: offlineResponder(message),
      conversationId: conversationId ?? "",
      ok: false,
      offline: true,
    };
  }
}

// Returns a context-blurb the UI can show while the assistant "thinks".
export function hermesThinking(): string {
  return "Hermes is working…";
}

// Break a reply into small chunks so the UI can "type" it out calmly.
export function streamText(text: string): string[] {
  const words = text.split(/(\s+)/);
  const chunks: string[] = [];
  let acc = "";
  for (const w of words) {
    acc += w;
    if (acc.length >= 3) {
      chunks.push(acc);
      acc = "";
    }
  }
  if (acc) chunks.push(chunks.length ? chunks[chunks.length - 1] + acc : acc);
  // ensure the final chunk equals the full text
  if (chunks.length === 0) return [text];
  chunks[chunks.length - 1] = text;
  return chunks;
}
