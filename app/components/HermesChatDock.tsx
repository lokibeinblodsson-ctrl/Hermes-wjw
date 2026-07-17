// Hermes AI assistant sidebar. Persistent, user-scoped conversation UI.
// Talks to /api/v1/hermes. Reads live board context (the backend attaches a
// board snapshot) and keeps history per conversation. Collapses on small
// screens. The LLM itself is rule-based server-side; this component just
// renders the conversation and sends messages.
import { useState, useEffect, useRef } from "react";
import { api } from "../lib/api";
import { useAuth } from "../App";

interface Msg { id: string; role: "user" | "assistant"; body: string; created_at?: string; }
interface Conv { id: string; title: string; updated_at: string; }

export default function HermesChatDock({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const [convs, setConvs] = useState<Conv[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [boardCount, setBoardCount] = useState<number | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  async function loadConvs() {
    try {
      const r = await api.get("/hermes/conversations");
      setConvs(r.data);
      if (!activeId && r.data.length) setActiveId(r.data[0].id);
    } catch { /* ignore */ }
  }

  useEffect(() => { loadConvs(); }, []);

  useEffect(() => {
    if (activeId) loadMessages(activeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  useEffect(() => {
    // Pull a light board count for context display.
    api.get("/board/cards").then((r) => setBoardCount(r.data.length)).catch(() => {});
  }, []);

  async function loadMessages(id: string) {
    try {
      const r = await api.get(`/hermes/conversations/${id}/messages`);
      setMessages(r.data.map((m: any) => ({ id: m.id, role: m.role, body: m.body, created_at: m.created_at })));
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

  async function send() {
    if (!input.trim() || busy) return;
    const text = input.trim();
    setInput("");
    setBusy(true);
    const optimistic: Msg = { id: `tmp_${Date.now()}`, role: "user", body: text };
    setMessages((m) => [...m, optimistic]);
    try {
      const r = await api.post("/hermes/chat", { conversation_id: activeId || undefined, message: text });
      if (!activeId && r.data.conversation_id) { setActiveId(r.data.conversation_id); }
      setMessages((m) => [...m, { id: `a_${Date.now()}`, role: "assistant", body: r.data.reply }]);
      loadConvs();
    } catch (e: any) {
      setMessages((m) => [...m, { id: `err_${Date.now()}`, role: "assistant", body: `⚠️ ${e.message || "Failed"}` }]);
    } finally {
      setBusy(false);
    }
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
          <div className="muted">Ask Hermes about the board, summarize content, or leave a note. History persists per conversation.</div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`hermes-msg ${m.role}`}>
            <span className="who">{m.role === "user" ? (user?.display_name || "you") : "Hermes"}</span>
            <div className="bubble">{renderBody(m.body)}</div>
          </div>
        ))}
        {busy && <div className="hermes-typing">Hermes is typing…</div>}
      </div>
      <div className="hermes-input">
        <textarea rows={2} value={input} placeholder="Ask Hermes…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <button className="btn-primary" disabled={busy || !input.trim()} onClick={send}>Send</button>
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
  // escape handled by React; just bold/code.
  const parts = s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return <>{parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith("`") && p.endsWith("`")) return <code key={i}>{p.slice(1, -1)}</code>;
    return <span key={i}>{p}</span>;
  })}</>;
}
