// Hermes AI assistant sidebar. Persistent, user-scoped conversation UI that
// supports BOTH read-only Q&A and CONFIRMED write actions.
//
// Security contract (client side — the server in src/routes/hermes.ts is the
// authoritative enforcer):
//   - The chat responder (/hermes/chat) is read-only; it never mutates data.
//   - To perform a write, the user's typed request is parsed CLIENT-SIDE into a
//     structured, allow-listed intent (see parseIntent). The UI then shows a
//     CONFIRMATION card describing exactly what will happen. Only after the
//     user clicks "Confirm" does the client call /hermes/actions.
//   - /hermes/actions carries the user's own JWT (from localStorage) — there is
//     no Hermes service account or elevated token. The server re-checks every
//     permission independently via the shared permission module.
//   - Denials from the server are rendered distinctly (red), and the assistant
//     never claims an action succeeded unless the server confirmed it.
//   - Card/comment/file content is never fed back into the action path as
//     instructions; it is only shown as context the user can read.
import { useState, useEffect, useRef } from "react";
import { api } from "../lib/api";
import { useAuth } from "../App";
import { HERMES_CONTEXT_EVENT, HermesContext } from "../lib/hermesBus";

interface Msg {
  id: string;
  role: "user" | "assistant" | "pending" | "result" | "denied";
  body: string;
  created_at?: string;
  // For pending (confirmation) messages:
  action?: string;
  params?: Record<string, any>;
  summary?: string; // human-readable description of the change
}
interface Conv { id: string; title: string; updated_at: string; }
interface Column { id: string; name: string; }

// Allow-listed action metadata for the confirmation UI (mirrors the server's
// HERMES_ALLOWED_ACTIONS — single source of truth is the server, this is just
// labels for the client).
const ACTION_LABELS: Record<string, string> = {
  create_card: "Create card",
  update_card: "Update card",
  move_card: "Move card",
  comment_on_card: "Comment on card",
  add_source: "Add source/citation",
  link_file: "Upload/link file",
  schedule_card: "Schedule card",
  submit_for_review: "Submit for review",
  approve_card: "Approve content",
  publish_card: "Publish content",
};

// A structured intent the client parsed from the user's words. The server
// validates it again; this is purely for building a confirmation UI.
interface Intent {
  action: string;
  params: Record<string, any>;
  summary: string; // what the user will see before confirming
}

// Lightweight, allow-list-only natural-language -> intent parser. ONLY produces
// actions that exist in ACTION_LABELS. Anything it can't confidently map falls
// through to a normal chat question (read-only).
function parseIntent(text: string, columns: Column[]): Intent | null {
  const t = text.trim();
  const low = t.toLowerCase();

  // create card: "create a card in Backlog titled X" / "new card ..."
  const createMatch = low.match(/^(create|new|add)\s+(a\s+)?card\s*(in\s+([\w\s-]+?))?\s*(titled|called|named|title)?\s*[:\-]?\s*(.*)$/i)
    || low.match(/^create card\s+(.*)$/i);
  if (/^(create|new|add)\s+(a\s+)?card/.test(low)) {
    const titled = t.match(/titled\s+["']?([^"']+)["']?/i)
      || t.match(/called\s+["']?([^"']+)["']?/i)
      || t.match(/named\s+["']?([^"']+)["']?/i)
      || t.match(/title\s+["']?([^"']+)["']?/i);
    const colM = t.match(/in\s+([\w\s-]+?)(?=\s+(titled|called|named|title|with|about)|$)/i);
    const colName = colM ? colM[1].trim() : "";
    const column = columns.find((c) => c.name.toLowerCase() === colName.toLowerCase());
    const title = titled ? titled[1].trim() : t.replace(/^(create|new|add)\s+(a\s+)?card\s*(in\s+[\w\s-]+)?\s*(titled|called|named|title)?\s*[:\-]?\s*/i, "").trim();
    if (title) {
      const params: Record<string, any> = { title, column_id: column?.id ?? columns[0]?.id };
      const where = column ? ` in "${column.name}"` : (columns[0] ? ` in "${columns[0].name}"` : "");
      return { action: "create_card", params, summary: `Create a new card${where} titled "${title}"` };
    }
  }

  // move card: "move card CARDID to Backlog" — needs a card id/token; we accept
  // an explicit id passed by the UI (e.g. from a card page) or a placeholder.
  const moveMatch = low.match(/^move\s+card\s+(\S+)\s+to\s+([\w\s-]+)$/i);
  if (moveMatch) {
    const colName = moveMatch[2].trim();
    const column = columns.find((c) => c.name.toLowerCase() === colName.toLowerCase());
    if (column) {
      return {
        action: "move_card",
        params: { card_id: moveMatch[1], column_id: column.id },
        summary: `Move card ${moveMatch[1]} to "${column.name}"`,
      };
    }
  }

  // comment on a card: "comment on CARDID: text" / "add comment to CARDID: text"
  const commentMatch = t.match(/^(comment on|add comment to|reply on)\s+(\S+)\s*[:\-]\s*(.*)$/i);
  if (commentMatch) {
    return {
      action: "comment_on_card",
      params: { card_id: commentMatch[2], body: commentMatch[3].trim() },
      summary: `Comment on card ${commentMatch[2]}: "${commentMatch[3].trim().slice(0, 80)}"`,
    };
  }

  // schedule card: "schedule CARDID for 2026-08-01"
  const schedMatch = t.match(/^schedule\s+(card\s+)?(\S+)\s+(for|on)\s+(\S+)/i);
  if (schedMatch) {
    return {
      action: "schedule_card",
      params: { card_id: schedMatch[2], scheduled_date: schedMatch[4] },
      summary: `Schedule card ${schedMatch[2]} for ${schedMatch[4]}`,
    };
  }

  return null;
}

export default function HermesChatDock({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const [convs, setConvs] = useState<Conv[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [boardCount, setBoardCount] = useState<number | null>(null);
  const [columns, setColumns] = useState<Column[]>([]);
  const [boardHint, setBoardHint] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  async function loadConvs() {
    try {
      const r = await api.get("/hermes/conversations");
      setConvs(r.data);
      if (!activeId && r.data.length) setActiveId(r.data[0].id);
    } catch { /* ignore */ }
  }

  useEffect(() => { loadConvs(); }, []);
  useEffect(() => { if (activeId) loadMessages(activeId); /* eslint-disable-next-line */ }, [activeId]);

  useEffect(() => {
    api.get("/board/cards").then((r) => setBoardCount(r.data.length)).catch(() => {});
    api.get("/board/columns").then((r) => setColumns(r.data)).catch(() => {});
  }, []);

  // Board-opened Hermes may receive read-only board context (visible cards /
  // columns). This is DATA for assist only — never instructions.
  useEffect(() => {
    const onCtx = (e: Event) => {
      const ctx = (e as CustomEvent<HermesContext>).detail;
      if (ctx?.hint) setBoardHint(ctx.hint);
      if (ctx?.board) setBoardHint(`Board context: ${ctx.board.cardCount} cards across ${ctx.board.columnCount} columns.`);
    };
    window.addEventListener(HERMES_CONTEXT_EVENT, onCtx as EventListener);
    return () => window.removeEventListener(HERMES_CONTEXT_EVENT, onCtx as EventListener);
  }, []);

  async function loadMessages(id: string) {
    try {
      const r = await api.get(`/hermes/conversations/${id}/messages`);
      setMessages(r.data.map((m: any) => ({ id: m.id, role: m.role as Msg["role"], body: m.body, created_at: m.created_at })));
    } catch { setMessages([]); }
  }

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages, busy]);

  async function newConversation() {
    try {
      const r = await api.post("/hermes/conversations", {});
      await loadConvs();
      setActiveId(r.data.id);
      setMessages([]);
    } catch { /* ignore */ }
  }

  // Submit a chat question (read-only path).
  async function sendChat(text: string) {
    if (busy) return;
    setBusy(true);
    const optimistic: Msg = { id: `tmp_${Date.now()}`, role: "user", body: text };
    setMessages((m) => [...m, optimistic]);
    try {
      const r = await api.post("/hermes/chat", { conversation_id: activeId || undefined, message: text });
      if (!activeId && r.data.conversation_id) setActiveId(r.data.conversation_id);
      setMessages((m) => [...m, { id: `a_${Date.now()}`, role: "assistant", body: r.data.reply }]);
      loadConvs();
    } catch (e: any) {
      setMessages((m) => [...m, { id: `err_${Date.now()}`, role: "assistant", body: `⚠️ ${e.message || "Failed"}` }]);
    } finally {
      setBusy(false);
    }
  }

  // Called when the user types something. Either it's a confirmable action or a
  // read-only question.
  function handleSend() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    const intent = parseIntent(text, columns);
    if (intent) {
      // Show a confirmation card — nothing is sent to the server yet.
      const id = `pend_${Date.now()}`;
      setMessages((m) => [...m, { id, role: "user", body: text }]);
      setMessages((m) => [...m, {
        id: `conf_${Date.now()}`, role: "pending", body: intent.summary,
        action: intent.action, params: intent.params, summary: intent.summary,
      }]);
    } else {
      sendChat(text);
    }
  }

  // User confirmed a pending action. Step 1: ask the server to authorize +
  // plan the action (allow-list + permission pre-check + rate limit). Step 2:
  // execute the returned plan against the REAL endpoint with the user's own
  // JWT — identical to using the UI. No nested/Hermes-only write path.
  async function confirmAction(msg: Msg) {
    if (!msg.action) return;
    setBusy(true);
    setMessages((m) => m.map((x) => (x.id === msg.id ? { ...x, role: "pending", body: msg.summary + " …" } : x)));
    try {
      // Step 1: server resolves intent -> plan (or refuses).
      const planRes = await api.post("/hermes/actions", { action: msg.action, params: msg.params || {} });
      if (!planRes.ok || !planRes.data?.plan) {
        const why = planRes.data?.message || planRes.data?.error?.message || "Not permitted.";
        setMessages((m) => m.map((x) => x.id === msg.id ? {
          id: `den_${Date.now()}`, role: "denied",
          body: `⛔ ${ACTION_LABELS[msg.action!] || msg.action} was not performed.\n${why}`,
        } : x));
        return;
      }
      // Step 2: execute the real endpoint (same as the UI would).
      const p = planRes.data.plan;
      const final = await api.request(p.method, p.path, p.body);
      if (final.ok) {
        setMessages((m) => m.map((x) => x.id === msg.id ? {
          id: `res_${Date.now()}`, role: "result",
          body: `✅ Done: ${ACTION_LABELS[msg.action!] || msg.action}.`,
        } : x));
      } else {
        const why = final.data?.error?.message || "Action failed";
        setMessages((m) => m.map((x) => x.id === msg.id ? {
          id: `den_${Date.now()}`, role: "denied",
          body: `⛔ ${ACTION_LABELS[msg.action!] || msg.action} failed.\n${why}`,
        } : x));
      }
    } catch (e: any) {
      setMessages((m) => m.map((x) => x.id === msg.id ? {
        id: `den_${Date.now()}`, role: "denied",
        body: `⛔ ${ACTION_LABELS[msg.action!] || msg.action} failed.\n${e.message || "Server error"}`,
      } : x));
    } finally {
      setBusy(false);
    }
  }

  function cancelAction(msg: Msg) {
    setMessages((m) => m.map((x) => x.id === msg.id ? {
      id: `can_${Date.now()}`, role: "assistant",
      body: `Cancelled: ${ACTION_LABELS[msg.action!] || msg.action}. No changes were made.`,
    } : x));
  }

  return (
    <aside className={`hermes-dock ${open ? "" : "closed"}`} aria-hidden={!open}>
      <div className="hermes-dock-header">
        <span className="h-title">🌿 Hermes</span>
        <span className="muted" style={{ fontSize: 12 }}>AI assistant</span>
        <button className="btn-link h-close" onClick={onClose}>✕</button>
      </div>
      <div className="hermes-ctx">
        <span className="muted">Context:</span>
        <span className="chip on">{boardCount ?? "…"} cards</span>
        <button className="btn-link small" onClick={newConversation}>+ new</button>
      </div>
      {boardHint && (
        <div className="hermes-ctx">
          <span className="muted">📋</span>
          <span className="chip">{boardHint}</span>
        </div>
      )}
      {convs.length > 1 && (
        <div className="hermes-ctx" style={{ flexWrap: "wrap", gap: 4 }}>
          {convs.slice(0, 6).map((c) => (
            <span key={c.id} className={`chip ${c.id === activeId ? "on" : ""}`} style={{ cursor: "pointer" }}
              onClick={() => setActiveId(c.id)} title={c.title}>
              {c.title.slice(0, 18) || "New"}
            </span>
          ))}
        </div>
      )}
      <div className="hermes-log" ref={logRef}>
        {messages.length === 0 && !busy && (
          <div className="muted">Ask Hermes about the board, or ask it to do something — e.g.
            <br /><span style={{ color: "var(--accent-2)" }}>"create a card in Backlog titled Launch post"</span>.
            <br />Any write action shows a confirmation first. History persists per conversation.</div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`hermes-msg ${m.role}`}>
            <span className="who">
              {m.role === "user" ? (user?.display_name || "you")
                : m.role === "pending" ? "Hermes · confirm?"
                : m.role === "denied" ? "Hermes · blocked"
                : m.role === "result" ? "Hermes · done"
                : "Hermes"}
            </span>
            <div className="bubble">{renderBody(m.body)}</div>
            {m.role === "pending" && (
              <div className="hermes-actions">
                <button className="btn-primary small" disabled={busy}
                  onClick={() => confirmAction(m)}>Confirm</button>
                <button className="btn-link small" disabled={busy}
                  onClick={() => cancelAction(m)}>Cancel</button>
              </div>
            )}
          </div>
        ))}
        {busy && <div className="hermes-typing">Hermes is working…</div>}
      </div>
      <div className="hermes-input">
        <textarea rows={2} value={input} placeholder="Ask or instruct Hermes…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }} />
        <button className="btn-primary" disabled={busy || !input.trim()} onClick={handleSend}>Send</button>
      </div>
    </aside>
  );
}

// Render assistant text with minimal markdown: **bold**, `code`, - lists.
function renderBody(body: string) {
  const lines = body.split("\n");
  const out: JSX.Element[] = [];
  let list: string[] = [];
  const flush = (key: string) => {
    if (list.length) { out.push(<ul key={key}>{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>); list = []; }
  };
  lines.forEach((ln, i) => {
    if (ln.trim().startsWith("- ")) { list.push(ln.trim().slice(2)); return; }
    flush(`l${i}`);
    if (ln.trim() === "") return;
    out.push(<div key={`p${i}`}>{inline(ln)}</div>);
  });
  flush("end");
  return <>{out}</>;
}
function inline(s: string): JSX.Element {
  const parts = s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return <>{parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith("`") && p.endsWith("`")) return <code key={i}>{p.slice(1, -1)}</code>;
    return <span key={i}>{p}</span>;
  })}</>;
}
