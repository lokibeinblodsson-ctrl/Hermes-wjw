import { useState, useEffect, useCallback } from "react";
import { api } from "../lib/api";

const TYPES = ["fact", "idea", "plan", "decision", "changelog", "bug", "request", "note"];

export default function MemoryPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [all, setAll] = useState<any[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [type, setType] = useState("note");
  const [tags, setTags] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const loadAll = useCallback(async () => {
    try { const r = await api.get("/admin/memory?limit=50"); setAll(r.data); } catch {}
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    try {
      const r = await api.get(`/memory/search?q=${encodeURIComponent(query)}&limit=10`);
      setResults(r.data);
    } catch (e: any) { setError(e.message); }
  }

  async function addNote(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMsg("");
    try {
      await api.post("/admin/memory", { type, title, body, tags: tags.split(",").map((t) => t.trim()).filter(Boolean) });
      setMsg("Saved to memory.");
      setTitle(""); setBody(""); setTags("");
      loadAll();
    } catch (e: any) { setError(e.message); }
  }

  return (
    <div className="memory-page">
      <h2>🧠 Semantic Memory (RAG)</h2>
      <p className="muted">Store project decisions, bugs, requests, plans, and notes. Search is keyword + semantic.</p>
      {error && <div className="error">{error}</div>}
      {msg && <div className="success">{msg}</div>}

      <div className="memory-grid">
        <div>
          <h3>Search</h3>
          <form onSubmit={search} className="toolbar-inline">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. authentication bug, kanban drag drop" />
            <button className="btn-primary">Search</button>
          </form>
          <div className="results">
            {results.map((r) => (
              <div key={r.id} className="mem-card">
                <div className="mem-head"><span className={`type-${r.type}`}>{r.type}</span><span className="score">{(r.score * 100).toFixed(0)}%</span></div>
                <div className="mem-title">{r.title}</div>
                <div className="mem-summary">{r.summary}</div>
                <div className="mem-time">{new Date(r.created_at).toLocaleString()}</div>
              </div>
            ))}
            {results.length === 0 && <div className="muted">No results yet. Try a search.</div>}
          </div>
        </div>

        <div>
          <h3>Add a memory</h3>
          <form onSubmit={addNote} className="mem-form">
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" required />
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} placeholder="Details…" />
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tags, comma, separated" />
            <button className="btn-primary">Save to memory</button>
          </form>

          <h3>Recent notes</h3>
          <div className="results">
            {all.map((r) => (
              <div key={r.id} className="mem-card">
                <div className="mem-head"><span className={`type-${r.type}`}>{r.type}</span></div>
                <div className="mem-title">{r.title}</div>
                <div className="mem-summary">{r.summary}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
