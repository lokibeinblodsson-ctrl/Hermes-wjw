import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, parseError } from "../lib/api";
import { useAuth } from "../App";
import { openHermes } from "../lib/hermesBus";

interface Column { id: string; name: string; position: number; color: string; }
interface Category { id: string; name: string; color: string; }
interface Card {
  id: string;
  column_id: string;
  title: string;
  description: string;
  priority: string;
  due_date: string | null;
  category_id: string | null;
  tags: string[];
  assignee_id: string | null;
  assignee_name?: string;
  position: number;
}

export default function KanbanPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [columns, setColumns] = useState<Column[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // filters
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("");
  const [filterPriority, setFilterPriority] = useState("");
  const [filterAssignee, setFilterAssignee] = useState("");
  const [sort, setSort] = useState("position");
  const [users, setUsers] = useState<{ id: string; display_name: string }[]>([]);
  // drag state
  const [dragId, setDragId] = useState<string | null>(null);
  // modal
  const [editing, setEditing] = useState<Card | null>(null);
  const [creatingCol, setCreatingCol] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      if (filterCat) params.set("category_id", filterCat);
      if (filterPriority) params.set("priority", filterPriority);
      if (filterAssignee) params.set("assignee_id", filterAssignee);
      params.set("sort", sort);
      const [cRes, catRes, cardRes] = await Promise.all([
        api.get("/board/columns"),
        api.get("/board/categories"),
        api.get(`/board/cards?${params.toString()}`),
      ]);
      setColumns(cRes.data);
      setCategories(catRes.data);
      setCards(cardRes.data);
      if (user?.role === "admin" || user?.role === "moderator") {
        try { const u = await api.get("/admin/users"); setUsers(u.data.map((x: any) => ({ id: x.id, display_name: x.display_name }))); } catch {}
      }
    } catch (e: any) {
      setError(e.message || "Failed to load board");
    } finally {
      setLoading(false);
    }
  }, [search, filterCat, filterPriority, filterAssignee, sort, user]);

  useEffect(() => { load(); }, [load]);

  // Deep-link: `?newcard=1` (e.g. from the command palette) opens the new-card
  // modal once columns are loaded, then clears the flag from the URL.
  useEffect(() => {
    if (searchParams.get("newcard") === "1" && columns.length && !editing) {
      setEditing({ id: "", column_id: columns[0]?.id || "", title: "", description: "", priority: "medium", due_date: null, category_id: null, tags: [], assignee_id: null } as any);
      searchParams.delete("newcard");
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, columns, editing]);

  const canManage = user?.role === "admin" || user?.role === "moderator";

  async function moveCard(cardId: string, toColumn: string) {
    // optimistic
    setCards((cs) => cs.map((c) => (c.id === cardId ? { ...c, column_id: toColumn } : c)));
    try {
      const c = cards.find((x) => x.id === cardId);
      await api.patch(`/board/cards/${cardId}`, { column_id: toColumn, position: 0 });
    } catch (e: any) {
      setError(e.message || "Move failed");
      load();
    }
  }

  async function addColumn() {
   if (!creatingCol.trim()) return;
   try {
     await api.post("/board/columns", { name: creatingCol.trim(), color: "#7c9c64" });
     setCreatingCol("");
     load();
   } catch (e: any) { setError(e.message); }
 }

 async function downloadBackup() {
   try {
     const res = await api.get("/data/backup");
     const data = res.data;
     const stamp = new Date(data.timestamp).toISOString().slice(0, 10);
     const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
     const url = URL.createObjectURL(blob);
     const a = document.createElement("a");
     a.href = url; a.download = `wjw-backup-${stamp}.json`; a.click();
     URL.revokeObjectURL(url);
   } catch (e: any) { setError(e.message); }
 }

  function filteredCards(colId: string): Card[] {
    return cards.filter((c) => c.column_id === colId);
  }

  return (
    <div className="kanban-page">
      <div className="toolbar">
        <input placeholder="Search cards…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)}>
          <option value="">All priorities</option>
          {["urgent", "high", "medium", "low"].map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        {canManage && (
          <select value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)}>
            <option value="">All assignees</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.display_name}</option>)}
          </select>
        )}
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="position">Sort: manual</option>
          <option value="due_date">Sort: due date</option>
          <option value="priority">Sort: priority</option>
          <option value="created_at">Sort: newest</option>
        </select>
        <button className="btn-primary" onClick={() => setEditing({ id: "", column_id: columns[0]?.id || "", title: "", description: "", priority: "medium", due_date: null, category_id: null, tags: [], assignee_id: null } as any)}>
          + New card
        </button>
        <button className="btn-link" onClick={() => openHermes({
          board: { cardCount: cards.length, columnCount: columns.length, columns: columns.map((c) => ({ name: c.name, count: 0 })) },
          hint: `Board open: ${cards.length} cards across ${columns.length} columns.`,
        })} title="Ask the Hermes assistant (with board context)">💬 Ask Hermes</button>
        {canManage && (
          <span className="addcol">
            <input placeholder="New column" value={creatingCol} onChange={(e) => setCreatingCol(e.target.value)} />
            <button onClick={addColumn}>+</button>
          </span>
        )}
        {(user?.role === "admin" || user?.role === "moderator") && (
          <button className="btn-primary" onClick={downloadBackup}>⤓ Backup</button>
        )}
      </div>
      {error && <div className="error">{error}</div>}
      {loading && <div className="muted">Loading board…</div>}

      <div className="board">
        {columns.map((col) => (
          <div
            key={col.id}
            className="column"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (dragId) moveCard(dragId, col.id); setDragId(null); }}
          >
            <div className="column-head" style={{ borderColor: col.color }}>
              <span className="dot" style={{ background: col.color }} />
              {col.name} <span className="count">{filteredCards(col.id).length}</span>
            </div>
            <div className="cards">
              {filteredCards(col.id).map((card) => {
                const cat = categories.find((c) => c.id === card.category_id);
                return (
                  <div
                    key={card.id}
                    className={`card priority-${card.priority}`}
                    draggable
                    onDragStart={() => setDragId(card.id)}
                    onClick={() => setEditing(card)}
                  >
                    <div className="card-title"><a href={`/card/${card.id}`} onClick={(e) => { e.preventDefault(); navigate(`/card/${card.id}`); }} title="Open card workspace">{card.title}</a></div>
                    <div className="card-meta">
                      {cat && <span className="tag" style={{ background: cat.color }}>{cat.name}</span>}
                      {card.tags.map((t) => <span key={t} className="tag outline">{t}</span>)}
                    </div>
                    <div className="card-foot">
                      <span className={`prio prio-${card.priority}`}>{card.priority}</span>
                      {card.due_date && <span className="due">📅 {card.due_date.slice(0, 10)}</span>}
                      {card.assignee_name && <span className="assignee">@{card.assignee_name}</span>}
                    </div>
                  </div>
                );
              })}
              {filteredCards(col.id).length === 0 && <div className="empty">No cards</div>}
            </div>
          </div>
        ))}
      </div>

      {editing && (
        <CardModal
          card={editing}
          categories={categories}
          users={users}
          canManage={canManage}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
          onDeleted={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function CardModal({ card, categories, users, canManage, onClose, onSaved, onDeleted }: any) {
  const isNew = !card.id;
  const [title, setTitle] = useState(card.title || "");
  const [description, setDescription] = useState(card.description || "");
  const [priority, setPriority] = useState(card.priority || "medium");
  const [dueDate, setDueDate] = useState(card.due_date ? card.due_date.slice(0, 10) : "");
  const [categoryId, setCategoryId] = useState(card.category_id || "");
  const [tags, setTags] = useState((card.tags || []).join(", "));
  const [assigneeId, setAssigneeId] = useState(card.assignee_id || "");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setErr("");
    const payload = {
      title,
      description,
      priority,
      due_date: dueDate || null,
      category_id: categoryId || null,
      tags: tags.split(",").map((t: string) => t.trim()).filter(Boolean),
      assignee_id: assigneeId || null,
    };
    try {
      if (isNew) {
        if (!card.column_id) { setErr("No column available — create a column first."); setBusy(false); return; }
        // backend cardCreateSchema requires column_id; the modal opens new cards
        // pre-bound to columns[0] (or the ?newcard deep-link), so it's always set
        // here. Without it the POST returns 400.
        await api.post("/board/cards", { ...payload, column_id: card.column_id });
      } else {
        await api.patch(`/board/cards/${card.id}`, payload);
      }
      onSaved();
    } catch (e: any) {
      // Surface the server's real validation message (or a friendly fallback)
      // inline in the modal — never the generic "Request failed (400)".
      setErr(parseError(e));
    } finally {
      setBusy(false);
    }
  }

  async function del() {
    if (!confirm("Delete this card?")) return;
    setBusy(true);
    try {
      await api.delete(`/board/cards/${card.id}`);
      onDeleted();
    } catch (e: any) {
      setErr(parseError(e));
    }
    finally { setBusy(false); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{isNew ? "New card" : "Edit card"}</h3>
        {err && <div className="error">{err}</div>}
        <label>Title</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Card title" />
        <label>Description</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
        <div className="grid2">
          <div>
            <label>Priority</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value)}>
              {["low", "medium", "high", "urgent"].map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label>Due date</label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>
        <div className="grid2">
          <div>
            <label>Category</label>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">None</option>
              {categories.map((c: Category) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label>Assignee</label>
            <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">Unassigned</option>
              {users.map((u: { id: string; display_name: string }) => <option key={u.id} value={u.id}>{u.display_name}</option>)}
            </select>
          </div>
        </div>
        <label>Tags (comma separated)</label>
        <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="design, urgent" />
        <div className="modal-actions">
          <button className="btn-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
          {!isNew && canManage && <button className="btn-danger" disabled={busy} onClick={del}>Delete</button>}
          <button className="btn-link" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
