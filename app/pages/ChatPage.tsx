import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api";
import { useAuth } from "../App";

interface Channel { id: string; name: string; description: string; is_private: number; }
interface Thread { id: string; channel_id: string; title: string; author_id: string; pinned: number; locked: number; }
interface Message { id: string; thread_id: string; parent_id: string | null; author_name: string; author_role: string; body: string; mentions: string[]; created_at: string; edited_at: string | null; }

export default function ChatPage() {
  const { user } = useAuth();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeChannel, setActiveChannel] = useState<string>("");
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThread, setActiveThread] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [newThreadTitle, setNewThreadTitle] = useState("");
  const [newMessage, setNewMessage] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [error, setError] = useState("");

  const loadChannels = useCallback(async () => {
    try {
      const res = await api.get("/chat/channels");
      setChannels(res.data);
      if (res.data.length && !activeChannel) setActiveChannel(res.data[0].id);
    } catch (e: any) { setError(e.message); }
  }, [activeChannel]);

  useEffect(() => { loadChannels(); }, [loadChannels]);

  useEffect(() => {
    if (!activeChannel) return;
    api.get(`/chat/threads?channel_id=${activeChannel}`)
      .then((r) => { setThreads(r.data); if (r.data.length && !activeThread) setActiveThread(r.data[0].id); })
      .catch((e) => setError(e.message));
  }, [activeChannel, activeThread]);

  useEffect(() => {
    if (!activeThread) return;
    api.get(`/chat/messages?thread_id=${activeThread}`)
      .then((r) => setMessages(r.data))
      .catch((e) => setError(e.message));
  }, [activeThread]);

  async function createThread(e: React.FormEvent) {
    e.preventDefault();
    if (!newThreadTitle.trim() || !activeChannel) return;
    try {
      const r = await api.post("/chat/threads", { channel_id: activeChannel, title: newThreadTitle.trim() });
      setNewThreadTitle("");
      setActiveThread(r.data.id);
      const res = await api.get(`/chat/threads?channel_id=${activeChannel}`);
      setThreads(res.data);
    } catch (e: any) { setError(e.message); }
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!newMessage.trim() || !activeThread) return;
    try {
      const mentions = extractMentions(newMessage);
      await api.post("/chat/messages", { thread_id: activeThread, parent_id: replyTo, body: newMessage.trim(), mentions });
      setNewMessage("");
      setReplyTo(null);
      const res = await api.get(`/chat/messages?thread_id=${activeThread}`);
      setMessages(res.data);
    } catch (e: any) { setError(e.message); }
  }

  function extractMentions(text: string): string[] {
    const matches = text.match(/@(\w+)/g) || [];
    return matches.map((m) => m.slice(1));
  }

  const canModerate = user?.role === "admin" || user?.role === "moderator";

  async function togglePin(t: Thread) {
    try { await api.patch(`/chat/threads/${t.id}`, { pinned: !t.pinned }); const res = await api.get(`/chat/threads?channel_id=${activeChannel}`); setThreads(res.data); } catch (e: any) { setError(e.message); }
  }
  async function toggleLock(t: Thread) {
    try { await api.patch(`/chat/threads/${t.id}`, { locked: !t.locked }); const res = await api.get(`/chat/threads?channel_id=${activeChannel}`); setThreads(res.data); } catch (e: any) { setError(e.message); }
  }
  async function deleteMessage(m: Message) {
    if (!confirm("Delete message?")) return;
    try { await api.delete(`/chat/messages/${m.id}`); const res = await api.get(`/chat/messages?thread_id=${activeThread}`); setMessages(res.data); } catch (e: any) { setError(e.message); }
  }

  return (
    <div className="chat-page">
      <div className="chat-sidebar">
        <h3>Channels</h3>
        {channels.map((c) => (
          <div key={c.id} className={`chan ${c.id === activeChannel ? "active" : ""}`} onClick={() => { setActiveChannel(c.id); setActiveThread(""); }}>
            # {c.name}
          </div>
        ))}
      </div>
      <div className="chat-main">
        {error && <div className="error">{error}</div>}
        <div className="thread-list">
          <form onSubmit={createThread} className="thread-new">
            <input value={newThreadTitle} onChange={(e) => setNewThreadTitle(e.target.value)} placeholder="New topic title…" />
            <button className="btn-primary">+</button>
          </form>
          {threads.map((t) => (
            <div key={t.id} className={`thread-item ${t.id === activeThread ? "active" : ""}`} onClick={() => setActiveThread(t.id)}>
              <span>{t.pinned ? "📌 " : ""}{t.title}</span>
              {canModerate && (
                <span className="thread-mod">
                  <button onClick={(e) => { e.stopPropagation(); togglePin(t); }}>pin</button>
                  <button onClick={(e) => { e.stopPropagation(); toggleLock(t); }}>{t.locked ? "unlock" : "lock"}</button>
                </span>
              )}
            </div>
          ))}
        </div>
        <div className="messages">
          {messages.map((m) => (
            <div key={m.id} className="message">
              <div className="msg-head">
                <strong>{m.author_name || "unknown"}</strong>
                <span className="role-badge">{m.author_role}</span>
                <span className="time">{new Date(m.created_at).toLocaleString()}</span>
                {m.parent_id && <span className="reply-tag">↳ reply</span>}
                {canModerate && <button className="btn-link" onClick={() => deleteMessage(m)}>delete</button>}
              </div>
              <div className="msg-body">{m.body}{m.edited_at && <em className="edited"> (edited)</em>}</div>
              <button className="btn-link small" onClick={() => setReplyTo(m.id)}>reply</button>
            </div>
          ))}
        </div>
        {replyTo && <div className="reply-banner">Replying to a message. <button className="btn-link" onClick={() => setReplyTo(null)}>cancel</button></div>}
        <form onSubmit={sendMessage} className="msg-input">
          <input value={newMessage} onChange={(e) => setNewMessage(e.target.value)} placeholder="Write a message… use @name to mention" />
          <button className="btn-primary" disabled={!activeThread}>Send</button>
        </form>
      </div>
    </div>
  );
}
