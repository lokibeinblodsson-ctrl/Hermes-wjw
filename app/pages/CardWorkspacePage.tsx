// Per-card workspace page. Route: /card/:id
// Left rail: editable metadata + platform-ready toggle + save.
// Main panel: tabbed — Draft (autosave), Media, Resources, Checklist,
// Details, Notes, Research (when research_page_id set).
import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../App";
import { PLATFORMS } from "../lib/constants";

type Tab = "draft" | "media" | "resources" | "checklist" | "details" | "notes" | "research";

interface ChecklistItem { id: string; text: string; done: boolean; }
interface MediaItem { id: string; url: string; type: string; name: string; }
interface ResourceItem { id: string; label: string; url: string; notes: string; }
interface CustomField { id: string; label: string; value: string; }

export default function CardWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canManage = user?.role === "admin" || user?.role === "moderator";
  const [card, setCard] = useState<any>(null);
  const [columns, setColumns] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("draft");
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // metadata edit state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [dueDate, setDueDate] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [columnId, setColumnId] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [contentPillar, setContentPillar] = useState("");
  const [platformReady, setPlatformReady] = useState(false);
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [scheduledDate, setScheduledDate] = useState("");

  // draft
  const [draft, setDraft] = useState("");
  // notes
  const [notes, setNotes] = useState("");
  // checklist
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  // media
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [newMediaUrl, setNewMediaUrl] = useState("");
  const [newMediaName, setNewMediaName] = useState("");
  // resources
  const [resources, setResources] = useState<ResourceItem[]>([]);
  // custom fields
  const [customFields, setCustomFields] = useState<CustomField[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cardRes, cols, cats, usersRes] = await Promise.all([
        api.get(`/board/cards/${id}`),
        api.get("/board/columns"),
        api.get("/board/categories"),
        canManage ? api.get("/admin/users") : Promise.resolve({ data: [] }),
      ]);
      const c = cardRes.data;
      setCard(c);
      setColumns(cols.data);
      setCategories(cats.data);
      setTitle(c.title || "");
      setDescription(c.description || "");
      setPriority(c.priority || "medium");
      setDueDate(c.due_date ? c.due_date.slice(0, 10) : "");
      setCategoryId(c.category_id || "");
      setAssigneeId(c.assignee_id || "");
      setColumnId(c.column_id || "");
      setTagsText((c.tags || []).join(", "));
      setContentPillar(c.content_pillar || "");
      setPlatformReady(!!c.platform_ready);
      setPlatforms(c.platforms || []);
      setScheduledDate(c.scheduled_date ? c.scheduled_date.slice(0, 10) : "");
      setDraft(c.draft || "");
      setNotes(c.notes || "");
      setChecklist(c.checklist || []);
      setMedia(c.media || []);
      setResources(c.resources || []);
      setCustomFields(c.custom_fields || []);
    } catch (e: any) {
      setError(e.message || "Failed to load card");
    } finally {
      setLoading(false);
    }
  }, [id, canManage]);

  useEffect(() => { load(); }, [load]);

  async function saveMeta() {
    setError("");
    const patch = {
      title, description, priority,
      due_date: dueDate || null,
      category_id: categoryId || null,
      assignee_id: assigneeId || null,
      column_id: columnId || null,
      tags: tagsText.split(",").map((t) => t.trim()).filter(Boolean),
      content_pillar: contentPillar || null,
      platform_ready: platformReady,
      platforms,
      scheduled_date: scheduledDate || null,
    };
    try {
      const r = await api.patch(`/board/cards/${id}`, patch);
      setCard(r.data);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (e: any) { setError(e.message); }
  }

  async function patchField(patch: Record<string, unknown>) {
    try {
      const r = await api.patch(`/board/cards/${id}`, patch);
      setCard(r.data);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (e: any) { setError(e.message); }
  }

  // ── Draft autosave (1s debounce) ──
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedDraft = useRef("");
  function onDraftChange(text: string) {
    setDraft(text);
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(async () => {
      if (text === lastSavedDraft.current) return;
      lastSavedDraft.current = text;
      await patchField({ draft: text });
    }, 1000);
  }
  // ── Notes autosave (1s debounce) ──
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedNotes = useRef("");
  function onNotesChange(text: string) {
    setNotes(text);
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(async () => {
      if (text === lastSavedNotes.current) return;
      lastSavedNotes.current = text;
      await patchField({ notes: text });
    }, 1000);
  }

  if (loading) return <div className="muted">Loading card…</div>;
  if (error && !card) return <div className="error">{error}</div>;

  function togglePlatform(p: string) {
    setPlatforms((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  // checklist helpers
  function addChecklistItem() {
    setChecklist((prev) => [...prev, { id: `c_${Date.now()}`, text: "", done: false }]);
  }
  function updateChecklist(i: number, patch: Partial<ChecklistItem>) {
    setChecklist((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function removeChecklist(i: number) { setChecklist((prev) => prev.filter((_, idx) => idx !== i)); }
  function moveChecklist(i: number, dir: -1 | 1) {
    setChecklist((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return next;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  function saveChecklist() { patchField({ checklist }); }
  const checklistDone = checklist.filter((c) => c.done).length;

  // media helpers
  function addMedia() {
    if (!newMediaUrl.trim()) return;
    const item: MediaItem = { id: `m_${Date.now()}`, url: newMediaUrl.trim(), type: guessType(newMediaUrl), name: newMediaName.trim() || newMediaUrl.trim() };
    const next = [...media, item];
    setMedia(next); setNewMediaUrl(""); setNewMediaName("");
    patchField({ media: next });
  }
  function removeMedia(i: number) { const next = media.filter((_, idx) => idx !== i); setMedia(next); patchField({ media: next }); }

  // resources helpers
  function addResource() { setResources((prev) => [...prev, { id: `r_${Date.now()}`, label: "", url: "", notes: "" }]); }
  function updateResource(i: number, patch: Partial<ResourceItem>) { setResources((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it))); }
  function removeResource(i: number) { setResources((prev) => prev.filter((_, idx) => idx !== i)); }
  function saveResources() { patchField({ resources }); }

  // custom field helpers
  function addCustomField() { setCustomFields((prev) => [...prev, { id: `f_${Date.now()}`, label: "", value: "" }]); }
  function updateCustomField(i: number, patch: Partial<CustomField>) { setCustomFields((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it))); }
  function removeCustomField(i: number) { setCustomFields((prev) => prev.filter((_, idx) => idx !== i)); }
  function saveCustomFields() { patchField({ custom_fields: customFields }); }

  async function duplicate() {
    if (!confirm("Duplicate this card?")) return;
    try {
      const r = await api.post("/board/cards", {
        column_id: card.column_id, title: `${card.title} (copy)`, description, priority,
        due_date: card.due_date, category_id: card.category_id, tags: card.tags,
        assignee_id: card.assignee_id, draft, checklist, media, resources, customFields,
        notes, contentPillar, platform_ready: card.platform_ready, platforms,
      });
      navigate(`/card/${r.data.id}`);
    } catch (e: any) { setError(e.message); }
  }
  async function remove() {
    if (!confirm("Delete this card? This cannot be undone.")) return;
    await api.delete(`/board/cards/${id}`);
    navigate("/");
  }

  return (
    <div className="card-workspace">
      <div className="ws-topbar">
        <button className="btn-link" onClick={() => navigate("/")}>← Back to board</button>
        <span className="ws-title">{title}</span>
        <span className="ws-saved">{savedAt ? `Saved ${savedAt}` : ""}</span>
        {canManage && (
          <span className="ws-actions">
            <button className="btn-link" onClick={duplicate}>Duplicate</button>
            <button className="btn-link danger" onClick={remove}>Delete</button>
          </span>
        )}
      </div>

      <div className="ws-body">
        {/* Left rail */}
        <aside className="ws-rail">
          <h3>Details</h3>
          {error && <div className="error">{error}</div>}
          <label>Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
          <label>Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
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
            <div>
              <label>Scheduled publish date</label>
              <input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} />
            </div>
          </div>
          <label>Column</label>
          <select value={columnId} onChange={(e) => setColumnId(e.target.value)}>
            {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <label>Category</label>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">None</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <label>Assignee</label>
          <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">Unassigned</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.display_name}</option>)}
          </select>
          <label>Tags (comma separated)</label>
          <input value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="design, urgent" />
          <label>Content pillar</label>
          <input value={contentPillar} onChange={(e) => setContentPillar(e.target.value)} placeholder="e.g. EFT / EFCT" />
          <label className="checkrow">
            <input type="checkbox" checked={platformReady} onChange={(e) => setPlatformReady(e.target.checked)} />
            Platform ready
          </label>
          <label>Platforms</label>
          <div className="chip-row">
            {PLATFORMS.map((p) => (
              <label key={p} className={`chip ${platforms.includes(p) ? "on" : ""}`}>
                <input type="checkbox" checked={platforms.includes(p)} onChange={() => togglePlatform(p)} /> {p}
              </label>
            ))}
          </div>
          <button className="btn-primary" onClick={saveMeta}>Save details</button>
        </aside>

        {/* Main panel */}
        <section className="ws-main">
          <div className="ws-tabs">
            {(["draft", "media", "resources", "checklist", "details", "notes", "research"] as Tab[]).filter((t) => t !== "research" || card.research_page_id).map((t) => (
              <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
                {t === "details" ? "Details" : t[0].toUpperCase() + t.slice(1)}
                {t === "checklist" && checklist.length > 0 ? ` (${checklistDone}/${checklist.length})` : ""}
              </button>
            ))}
          </div>

          <div className="ws-panel">
            {tab === "draft" && (
              <div className="tab-draft">
                <p className="muted">Working content draft. Autosaves after 1s of inactivity.</p>
                <textarea className="big" value={draft} onChange={(e) => onDraftChange(e.target.value)} rows={20} placeholder="Write the draft here…" />
              </div>
            )}

            {tab === "media" && (
              <div className="tab-media">
                <ul className="item-list">
                  {media.map((m, i) => (
                    <li key={m.id}>
                      <span className="item-main">
                        <strong>{m.name || m.url}</strong> <span className="muted">[{m.type}]</span>
                        <br /><a href={m.url} target="_blank" rel="noreferrer">{m.url}</a>
                      </span>
                      <button className="btn-link danger" onClick={() => removeMedia(i)}>remove</button>
                    </li>
                  ))}
                  {media.length === 0 && <li className="muted">No media yet.</li>}
                </ul>
                <div className="add-row">
                  <input value={newMediaUrl} onChange={(e) => setNewMediaUrl(e.target.value)} placeholder="https://… image/video URL" />
                  <input value={newMediaName} onChange={(e) => setNewMediaName(e.target.value)} placeholder="name (optional)" />
                  <button className="btn-primary" onClick={addMedia}>Add</button>
                </div>
                <p className="muted">Upload not wired to storage yet — paste a hosted URL. (Binary upload is planned.)</p>
              </div>
            )}

            {tab === "resources" && (
              <div className="tab-resources">
                <ul className="item-list">
                  {resources.map((r, i) => (
                    <li key={r.id}>
                      <div className="item-main">
                        <input className="inline" value={r.label} onChange={(e) => updateResource(i, { label: e.target.value })} placeholder="label" />
                        <input className="inline" value={r.url} onChange={(e) => updateResource(i, { url: e.target.value })} placeholder="https://…" />
                        <input className="inline" value={r.notes} onChange={(e) => updateResource(i, { notes: e.target.value })} placeholder="notes" />
                      </div>
                      <button className="btn-link danger" onClick={() => removeResource(i)}>x</button>
                    </li>
                  ))}
                  {resources.length === 0 && <li className="muted">No resources yet.</li>}
                </ul>
                <div className="add-row">
                  <button className="btn-primary" onClick={addResource}>Add resource</button>
                  <button className="btn-link" onClick={saveResources}>Save resources</button>
                </div>
              </div>
            )}

            {tab === "checklist" && (
              <div className="tab-checklist">
                <p className="muted">Completion: {checklistDone}/{checklist.length}</p>
                <ul className="item-list">
                  {checklist.map((c, i) => (
                    <li key={c.id}>
                      <input type="checkbox" checked={c.done} onChange={(e) => updateChecklist(i, { done: e.target.checked })} />
                      <input className="inline grow" value={c.text} onChange={(e) => updateChecklist(i, { text: e.target.value })} placeholder="task" />
                      <button className="btn-link" onClick={() => moveChecklist(i, -1)}>↑</button>
                      <button className="btn-link" onClick={() => moveChecklist(i, 1)}>↓</button>
                      <button className="btn-link danger" onClick={() => removeChecklist(i)}>x</button>
                    </li>
                  ))}
                  {checklist.length === 0 && <li className="muted">No items.</li>}
                </ul>
                <div className="add-row">
                  <button className="btn-primary" onClick={addChecklistItem}>Add item</button>
                  <button className="btn-link" onClick={saveChecklist}>Save checklist</button>
                </div>
              </div>
            )}

            {tab === "details" && (
              <div className="tab-details">
                <ReadOnlyField label="Card ID" value={card.id} />
                <ReadOnlyField label="Title" value={card.title} />
                <ReadOnlyField label="Column" value={columns.find((c) => c.id === card.column_id)?.name || card.column_id} />
                <ReadOnlyField label="Category" value={categories.find((c) => c.id === card.category_id)?.name || "—"} />
                <ReadOnlyField label="Priority" value={card.priority} />
                <ReadOnlyField label="Due" value={card.due_date ? card.due_date.slice(0, 10) : "—"} />
                <ReadOnlyField label="Scheduled" value={card.scheduled_date ? card.scheduled_date.slice(0, 10) : "—"} />
                <ReadOnlyField label="Content pillar" value={card.content_pillar || "—"} />
                <ReadOnlyField label="Platform ready" value={card.platform_ready ? "yes" : "no"} />
                <ReadOnlyField label="Platforms" value={(card.platforms || []).join(", ") || "—"} />
                <ReadOnlyField label="Tags" value={(card.tags || []).join(", ") || "—"} />
                <ReadOnlyField label="Research page" value={card.research_page_id || "—"} />
                <h4>Custom fields</h4>
                <ul className="item-list">
                  {customFields.map((f, i) => (
                    <li key={f.id}>
                      <input className="inline" value={f.label} onChange={(e) => updateCustomField(i, { label: e.target.value })} placeholder="label" />
                      <input className="inline grow" value={f.value} onChange={(e) => updateCustomField(i, { value: e.target.value })} placeholder="value" />
                      <button className="btn-link danger" onClick={() => removeCustomField(i)}>x</button>
                    </li>
                  ))}
                  {customFields.length === 0 && <li className="muted">No custom fields.</li>}
                </ul>
                <div className="add-row">
                  <button className="btn-primary" onClick={addCustomField}>Add custom field</button>
                  <button className="btn-link" onClick={saveCustomFields}>Save custom fields</button>
                </div>
              </div>
            )}

            {tab === "notes" && (
              <div className="tab-notes">
                <p className="muted">Freeform notes — this is where you leave instructions for Hermes in the research workflow.</p>
                <textarea className="big" value={notes} onChange={(e) => onNotesChange(e.target.value)} rows={20} placeholder="Instructions / context for Hermes…" />
              </div>
            )}

            {tab === "research" && card.research_page_id && (
              <div className="tab-research">
                <p>Linked research page: <code>{card.research_page_id}</code></p>
                <button className="btn-link" onClick={() => navigate(`/card/${card.research_page_id}`)}>Open research page →</button>
                <p className="muted">Hermes Action Log summary appears here once the research workflow is connected.</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="kv"><span className="k">{label}</span><span className="v">{value}</span></div>
  );
}

function guessType(url: string): string {
  const u = url.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|svg)$/.test(u)) return "image";
  if (/\.(mp4|webm|mov)$/.test(u)) return "video";
  if (/\.(mp3|wav|ogg)$/.test(u)) return "audio";
  if (/\.(pdf|docx?|txt)$/.test(u)) return "doc";
  return "link";
}
