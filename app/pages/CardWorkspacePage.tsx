// Card hub / record view. Route: /card/:id
// The board is the summary; this page is the detailed operational record.
// Summary header + grouped tabs:
//   Overview (key metadata at a glance), Activity (card-scoped audit),
//   Comments (threaded), Sources (APA citations), Related (cards + posts),
//   plus the existing working sections: Draft, Media, Resources, Checklist,
//   Details, Notes (Hermes instructions), Research.
import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../App";
import { PLATFORMS } from "../lib/constants";

type Tab =
  | "overview" | "activity" | "comments" | "sources" | "related"
  | "draft" | "media" | "resources" | "checklist" | "details" | "notes" | "research";

interface ChecklistItem { id: string; text: string; done: boolean; }
interface MediaItem { id: string; url: string; type: string; name: string; }
interface ResourceItem { id: string; label: string; url: string; notes: string; }
interface CustomField { id: string; label: string; value: string; }
interface Comment { id: string; card_id: string; parent_id: string | null; author_id: string | null; author_name: string; body: string; deleted_at: string | null; created_at: string; updated_at: string; }
interface Source { id: string; source_type: string; authors: string; year: string | null; title: string; publisher: string; url: string | null; retrieved_date: string | null; citation: string; note: string; created_at: string; }
interface Link { id: string; link_type: string; target_card_id: string | null; target_title: string; target_url: string | null; note: string; }

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
  const [tab, setTab] = useState<Tab>("overview");
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

  // draft / notes
  const [draft, setDraft] = useState("");
  const [notes, setNotes] = useState("");
  // checklist / media / resources / custom fields
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [newMediaUrl, setNewMediaUrl] = useState("");
  const [newMediaName, setNewMediaName] = useState("");
  const [resources, setResources] = useState<ResourceItem[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);

  // hub sections
  const [comments, setComments] = useState<Comment[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [links, setLinks] = useState<Link[]>([]);

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

  // Load hub sections whenever we land on their tab (lazy-ish, but cheap to load all on open).
  const loadHub = useCallback(async () => {
    try {
      const [c, a, s, l] = await Promise.all([
        api.get(`/board/cards/${id}/comments`),
        api.get(`/board/cards/${id}/activity`),
        api.get(`/board/cards/${id}/sources`),
        api.get(`/board/cards/${id}/links`),
      ]);
      setComments(c.data || []);
      setActivity(a.data || []);
      setSources(s.data || []);
      setLinks(l.data || []);
    } catch { /* hub sections fail soft */ }
  }, [id]);
  useEffect(() => { loadHub(); }, [loadHub]);

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
  function addChecklistItem() { setChecklist((prev) => [...prev, { id: `c_${Date.now()}`, text: "", done: false }]); }
  function updateChecklist(i: number, patch: Partial<ChecklistItem>) { setChecklist((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it))); }
  function removeChecklist(i: number) { setChecklist((prev) => prev.filter((_, idx) => idx !== i)); }
  function moveChecklist(i: number, dir: -1 | 1) {
    setChecklist((prev) => {
      const next = [...prev]; const j = i + dir;
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
    const next = [...media, item]; setMedia(next); setNewMediaUrl(""); setNewMediaName("");
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
      {/* ── Summary header ── */}
      <div className="ws-header">
        <div className="ws-header-top">
          <button className="btn-link" onClick={() => navigate("/")}>← Board</button>
          <span className={`prio prio-${priority}`}>{priority}</span>
          {card.platform_ready && <span className="tag">platform ready</span>}
          <span className="ws-saved">{savedAt ? `Saved ${savedAt}` : ""}</span>
          {canManage && (
            <span className="ws-actions">
              <button className="btn-link" onClick={duplicate}>Duplicate</button>
              <button className="btn-link danger" onClick={remove}>Delete</button>
            </span>
          )}
        </div>
        <h1 className="ws-h1">{title}</h1>
        {description && <p className="ws-desc">{description}</p>}
        <div className="ws-meta-row">
          <Meta label="Column" value={columns.find((c) => c.id === card.column_id)?.name || "—"} />
          <Meta label="Category" value={categories.find((c) => c.id === card.category_id)?.name || "—"} />
          <Meta label="Assignee" value={card.assignee_name || "Unassigned"} />
          <Meta label="Due" value={card.due_date ? card.due_date.slice(0, 10) : "—"} />
          <Meta label="Scheduled" value={card.scheduled_date ? card.scheduled_date.slice(0, 10) : "—"} />
          <Meta label="Pillar" value={card.content_pillar || "—"} />
          <Meta label="Platforms" value={(card.platforms || []).join(", ") || "—"} />
        </div>
      </div>

      <div className="ws-body">
        {/* Left rail: editable details */}
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

        {/* Main panel: tabbed hub */}
        <section className="ws-main">
          <div className="ws-tabs">
            {([
              "overview", "activity", "comments", "sources", "related",
              "draft", "media", "resources", "checklist", "details", "notes", "research",
            ] as Tab[]).filter((t) => t !== "research" || card.research_page_id).map((t) => (
              <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
                {t[0].toUpperCase() + t.slice(1).replace("sources", "Sources").replace("related", "Related")}
                {t === "comments" && comments.length > 0 ? ` (${comments.length})` : ""}
                {t === "sources" && sources.length > 0 ? ` (${sources.length})` : ""}
                {t === "related" && links.length > 0 ? ` (${links.length})` : ""}
                {t === "checklist" && checklist.length > 0 ? ` (${checklistDone}/${checklist.length})` : ""}
              </button>
            ))}
          </div>

          <div className="ws-panel">
            {/* ── OVERVIEW ── */}
            {tab === "overview" && (
              <div className="tab-overview">
                <p className="muted">Operational snapshot. Full history lives under Activity; working content under Draft; Hermes instructions under Notes.</p>
                <div className="overview-grid">
                  <ReadOnlyField label="Card ID" value={card.id} />
                  <ReadOnlyField label="Status" value={`${columns.find((c) => c.id === card.column_id)?.name || card.column_id}${card.platform_ready ? " · ready" : ""}`} />
                  <ReadOnlyField label="Priority" value={card.priority} />
                  <ReadOnlyField label="Due" value={card.due_date ? card.due_date.slice(0, 10) : "—"} />
                  <ReadOnlyField label="Scheduled publish" value={card.scheduled_date ? card.scheduled_date.slice(0, 10) : "—"} />
                  <ReadOnlyField label="Content pillar" value={card.content_pillar || "—"} />
                  <ReadOnlyField label="Platform ready" value={card.platform_ready ? "yes" : "no"} />
                  <ReadOnlyField label="Platforms" value={(card.platforms || []).join(", ") || "—"} />
                  <ReadOnlyField label="Tags" value={(card.tags || []).join(", ") || "—"} />
                  <ReadOnlyField label="Research page" value={card.research_page_id || "—"} />
                  <ReadOnlyField label="Comments" value={`${comments.length}`} />
                  <ReadOnlyField label="Sources" value={`${sources.length}`} />
                  <ReadOnlyField label="Related items" value={`${links.length}`} />
                  <ReadOnlyField label="Created" value={card.created_at ? card.created_at.slice(0, 10) : "—"} />
                  <ReadOnlyField label="Updated" value={card.updated_at ? card.updated_at.slice(0, 10) : "—"} />
                </div>
              </div>
            )}

            {/* ── ACTIVITY (card-scoped audit) ── */}
            {tab === "activity" && (
              <div className="tab-activity">
                <p className="muted">Timeline of changes to this card (edits, schedule changes, comments, links, publishing events).</p>
                <div className="activity-feed">
                  {activity.length === 0 && <div className="muted">No activity recorded yet.</div>}
                  {activity.map((a) => (
                    <div key={a.id} className="activity-row">
                      <span className="act-action">{a.action}</span>
                      <span className="act-meta">{a.meta && Object.keys(a.meta).length ? JSON.stringify(a.meta) : ""}</span>
                      <span className="act-time">{new Date(a.created_at).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── COMMENTS (threaded) ── */}
            {tab === "comments" && (
              <CommentsTab
                cardId={id!} comments={comments} setComments={setComments}
                canManage={canManage} currentName={user?.display_name || ""}
              />
            )}

            {/* ── SOURCES (APA) ── */}
            {tab === "sources" && (
              <SourcesTab cardId={id!} sources={sources} setSources={setSources} />
            )}

            {/* ── RELATED ── */}
            {tab === "related" && (
              <RelatedTab cardId={id!} links={links} setLinks={setLinks} columns={columns} navigate={navigate} />
            )}

            {/* ── DRAFT ── */}
            {tab === "draft" && (
              <div className="tab-draft">
                <p className="muted">Working content draft. Autosaves after 1s of inactivity.</p>
                <textarea className="big" value={draft} onChange={(e) => onDraftChange(e.target.value)} rows={20} placeholder="Write the draft here…" />
              </div>
            )}

            {/* ── MEDIA ── */}
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
                <p className="muted">Paste a hosted URL (binary upload is planned).</p>
              </div>
            )}

            {/* ── RESOURCES ── */}
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

            {/* ── CHECKLIST ── */}
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

            {/* ── DETAILS ── */}
            {tab === "details" && (
              <div className="tab-details">
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

            {/* ── NOTES (Hermes instructions) ── */}
            {tab === "notes" && (
              <div className="tab-notes">
                <p className="muted">Hermes instructions / internal notes. Separate from the public draft.</p>
                <textarea className="big" value={notes} onChange={(e) => onNotesChange(e.target.value)} rows={20} placeholder="Instructions / context for Hermes…" />
              </div>
            )}

            {/* ── RESEARCH ── */}
            {tab === "research" && card.research_page_id && (
              <div className="tab-research">
                <p>Linked research page: <code>{card.research_page_id}</code></p>
                <button className="btn-link" onClick={() => navigate(`/card/${card.research_page_id}`)}>Open research page →</button>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <span className="ws-meta"><span className="ws-meta-k">{label}</span><span className="ws-meta-v">{value}</span></span>
  );
}
function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (<div className="kv"><span className="k">{label}</span><span className="v">{value}</span></div>);
}

// ── Threaded comments ───────────────────────────────────────────────────────
function CommentsTab({ cardId, comments, setComments, canManage, currentName }: {
  cardId: string; comments: Comment[]; setComments: (c: Comment[]) => void; canManage: boolean; currentName: string;
}) {
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const topLevel = comments.filter((c) => !c.parent_id && !c.deleted_at);
  function repliesOf(pid: string) { return comments.filter((c) => c.parent_id === pid && !c.deleted_at); }

  async function post(parent_id: string | null, text: string) {
    if (!text.trim()) return;
    setBusy(true); setErr("");
    try {
      const r = await api.post(`/board/cards/${cardId}/comments`, { body: text.trim(), parent_id });
      setComments([...comments, r.data as Comment]);
      setBody(""); setReplyText(""); setReplyTo(null);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function del(c: Comment) {
    if (!confirm("Delete this comment?")) return;
    try {
      await api.delete(`/board/cards/${cardId}/comments/${c.id}`);
      setComments(comments.map((x) => (x.id === c.id ? { ...x, deleted_at: new Date().toISOString(), body: "[deleted]" } : x)));
    } catch (e: any) { setErr(e.message); }
  }

  return (
    <div className="tab-comments">
      {err && <div className="error">{err}</div>}
      <div className="comment-compose">
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder="Add a comment…" />
        <button className="btn-primary" disabled={busy || !body.trim()} onClick={() => post(null, body)}>Comment</button>
      </div>
      <div className="comment-list">
        {topLevel.length === 0 && <div className="muted">No comments yet.</div>}
        {topLevel.map((c) => (
          <div key={c.id} className="comment">
            <div className="comment-head"><strong>{c.author_name}</strong> <span className="muted">{new Date(c.created_at).toLocaleString()}</span></div>
            <div className="comment-body">{c.body}</div>
            <div className="comment-actions">
              <button className="btn-link small" onClick={() => setReplyTo(replyTo === c.id ? null : c.id)}>reply</button>
              {canManage && <button className="btn-link small danger" onClick={() => del(c)}>delete</button>}
            </div>
            {replyTo === c.id && (
              <div className="comment-reply">
                <input value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder="Reply…" />
                <button className="btn-primary" disabled={busy || !replyText.trim()} onClick={() => post(c.id, replyText)}>Reply</button>
              </div>
            )}
            {repliesOf(c.id).map((r) => (
              <div key={r.id} className="comment reply">
                <div className="comment-head"><strong>{r.author_name}</strong> <span className="muted">{new Date(r.created_at).toLocaleString()}</span></div>
                <div className="comment-body">{r.body}</div>
                <div className="comment-actions">
                  {canManage && <button className="btn-link small danger" onClick={() => del(r)}>delete</button>}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Sources / APA citations ─────────────────────────────────────────────────
function SourcesTab({ cardId, sources, setSources }: {
  cardId: string; sources: Source[]; setSources: (s: Source[]) => void;
}) {
  const [form, setForm] = useState({ source_type: "website", authors: "", year: "", title: "", publisher: "", url: "", retrieved_date: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function set(k: string, v: string) { setForm((f) => ({ ...f, [k]: v })); }
  async function add() {
    setBusy(true); setErr("");
    try {
      const r = await api.post(`/board/cards/${cardId}/sources`, { ...form, year: form.year || null, url: form.url || null });
      setSources([...sources, r.data as Source]);
      setForm({ source_type: "website", authors: "", year: "", title: "", publisher: "", url: "", retrieved_date: "", note: "" });
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function remove(s: Source) {
    if (!confirm("Remove this source?")) return;
    try { await api.delete(`/board/cards/${cardId}/sources/${s.id}`); setSources(sources.filter((x) => x.id !== s.id)); } catch (e: any) { setErr(e.message); }
  }

  return (
    <div className="tab-sources">
      {err && <div className="error">{err}</div>}
      <div className="source-list">
        {sources.length === 0 && <div className="muted">No sources yet.</div>}
        {sources.map((s) => (
          <div key={s.id} className="source-card">
            <div className="source-top">
              <span className="tag">{s.source_type}</span>
              <button className="btn-link danger small" onClick={() => remove(s)}>remove</button>
            </div>
            <div className="source-citation">{s.citation || "(incomplete citation)"}</div>
            {s.url && <a href={s.url} target="_blank" rel="noreferrer" className="source-link">{s.url}</a>}
            {s.note && <div className="muted">{s.note}</div>}
          </div>
        ))}
      </div>
      <div className="source-form">
        <h4>Add source</h4>
        <div className="grid2">
          <select value={form.source_type} onChange={(e) => set("source_type", e.target.value)}>
            {["website", "article", "book", "scholarly", "reference"].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input value={form.year} onChange={(e) => set("year", e.target.value)} placeholder="Year" />
        </div>
        <input value={form.authors} onChange={(e) => set("authors", e.target.value)} placeholder="Authors (APA: Smith, J., & Doe, A.)" />
        <input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Title" />
        <div className="grid2">
          <input value={form.publisher} onChange={(e) => set("publisher", e.target.value)} placeholder="Publisher / outlet" />
          <input value={form.retrieved_date} onChange={(e) => set("retrieved_date", e.target.value)} placeholder="Retrieved date (websites)" />
        </div>
        <input value={form.url} onChange={(e) => set("url", e.target.value)} placeholder="URL" />
        <input value={form.note} onChange={(e) => set("note", e.target.value)} placeholder="Note (why this matters)" />
        <button className="btn-primary" disabled={busy} onClick={add}>Add source</button>
        <p className="muted">APA citation is built automatically; edit the structured fields and it refreshes.</p>
      </div>
    </div>
  );
}

// ── Related cards + posts ───────────────────────────────────────────────────
function RelatedTab({ cardId, links, setLinks, columns, navigate }: {
  cardId: string; links: Link[]; setLinks: (l: Link[]) => void; columns: any[]; navigate: (p: string) => void;
}) {
  const [mode, setMode] = useState<"related_card" | "related_post">("related_card");
  const [targetId, setTargetId] = useState("");
  const [targetTitle, setTargetTitle] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [note, setNote] = useState("");
  const [cards, setCards] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (mode === "related_card") {
      api.get("/board/cards?sort=position").then((r) => setCards(r.data.filter((c: any) => c.id !== cardId))).catch(() => {});
    }
  }, [mode, cardId]);

  async function add() {
    setBusy(true); setErr("");
    try {
      const payload = mode === "related_card"
        ? { link_type: "related_card", target_card_id: targetId, note }
        : { link_type: "related_post", target_title: targetTitle, target_url: targetUrl || null, note };
      const r = await api.post(`/board/cards/${cardId}/links`, payload);
      setLinks([...links, r.data as Link]);
      setTargetId(""); setTargetTitle(""); setTargetUrl(""); setNote("");
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function remove(l: Link) {
    if (!confirm("Remove this link?")) return;
    try { await api.delete(`/board/cards/${cardId}/links/${l.id}`); setLinks(links.filter((x) => x.id !== l.id)); } catch (e: any) { setErr(e.message); }
  }

  const cards2 = links.filter((l) => l.link_type === "related_card");
  const posts = links.filter((l) => l.link_type === "related_post");

  return (
    <div className="tab-related">
      {err && <div className="error">{err}</div>}
      <div className="related-section">
        <h4>Related cards</h4>
        <div className="related-list">
          {cards2.length === 0 && <div className="muted">No related cards.</div>}
          {cards2.map((l) => (
            <div key={l.id} className="related-item">
              <a href={`/card/${l.target_card_id}`} onClick={(e) => { e.preventDefault(); navigate(`/card/${l.target_card_id}`); }}>{l.target_title}</a>
              {l.note && <span className="muted"> — {l.note}</span>}
              <button className="btn-link danger small" onClick={() => remove(l)}>unlink</button>
            </div>
          ))}
        </div>
      </div>
      <div className="related-section">
        <h4>Related posts / pages</h4>
        <div className="related-list">
          {posts.length === 0 && <div className="muted">No related posts.</div>}
          {posts.map((l) => (
            <div key={l.id} className="related-item">
              {l.target_url ? <a href={l.target_url} target="_blank" rel="noreferrer">{l.target_title}</a> : <span>{l.target_title}</span>}
              {l.note && <span className="muted"> — {l.note}</span>}
              <button className="btn-link danger small" onClick={() => remove(l)}>unlink</button>
            </div>
          ))}
        </div>
      </div>
      <div className="related-form">
        <h4>Add link</h4>
        <div className="grid2">
          <select value={mode} onChange={(e) => setMode(e.target.value as any)}>
            <option value="related_card">Related card</option>
            <option value="related_post">Related post / page</option>
          </select>
          {mode === "related_card"
            ? <select value={targetId} onChange={(e) => setTargetId(e.target.value)}><option value="">Select card…</option>{cards.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select>
            : <input value={targetTitle} onChange={(e) => setTargetTitle(e.target.value)} placeholder="Post / page title" />}
        </div>
        {mode === "related_post" && <input value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)} placeholder="Live URL (optional)" />}
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" />
        <button className="btn-primary" disabled={busy || (mode === "related_card" ? !targetId : !targetTitle.trim())} onClick={add}>Add link</button>
      </div>
    </div>
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
