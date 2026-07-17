// Browser bridge: exposes window.__wjw so Hermes (or a developer) can drive the
// live board from the DevTools console. Every write goes through the REST API
// layer — no direct DOM mutation. All calls are logged with a [wjw] prefix.
// Exposed in both development and production builds.
import { api } from "./api";

type NavFn = (path: string) => void;

let navigate: NavFn = (path) => {
  // Fallback when the router hasn't registered a navigator yet.
  window.location.assign(path);
};

// Called once from App to wire in react-router navigation (SPA-friendly).
export function setBridgeNavigate(fn: NavFn) {
  navigate = fn;
}

function log(method: string, ...args: unknown[]) {
  // eslint-disable-next-line no-console
  console.log(`[wjw] ${method}`, ...args);
}

async function cards() {
  log("cards()");
  const r = await api.get("/board/cards?sort=position");
  return r.data;
}

async function card(id: string) {
  log("card(id)", id);
  const r = await api.get(`/board/cards/${id}`);
  return r.data;
}

async function update(id: string, patch: Record<string, unknown>) {
  log("update(id, patch)", id, patch);
  const r = await api.patch(`/board/cards/${id}`, patch);
  return r.data;
}

async function setDraft(id: string, text: string) {
  log("setDraft(id, text)", id, text);
  const r = await api.patch(`/board/cards/${id}`, { draft: text });
  return r.data;
}

async function note(id: string, text: string) {
  log("note(id, text)", id, text);
  const existing = await api.get(`/board/cards/${id}`);
  const prev = existing.data.notes || "";
  const next = prev ? `${prev}\n${text}` : text;
  const r = await api.patch(`/board/cards/${id}`, { notes: next });
  return r.data;
}

async function move(id: string, column: string) {
  log("move(id, column)", id, column);
  // Accept a column id OR a column name.
  const cols = await api.get("/board/columns");
  const match = (cols.data as any[]).find(
    (c) => c.id === column || String(c.name).toLowerCase() === String(column).toLowerCase()
  );
  if (!match) throw new Error(`[wjw] No column matching "${column}"`);
  const r = await api.patch(`/board/cards/${id}`, { column_id: match.id, position: 0 });
  return r.data;
}

async function duplicate(id: string) {
  log("duplicate(id)", id);
  const src = (await api.get(`/board/cards/${id}`)).data;
  const payload = {
    column_id: src.column_id,
    title: `${src.title} (copy)`,
    description: src.description,
    priority: src.priority,
    due_date: src.due_date,
    category_id: src.category_id,
    tags: src.tags,
    assignee_id: src.assignee_id,
    draft: src.draft,
    checklist: src.checklist,
    media: src.media,
    resources: src.resources,
    custom_fields: src.custom_fields,
    notes: src.notes,
    content_pillar: src.content_pillar,
    platform_ready: src.platform_ready,
    platforms: src.platforms,
  };
  const r = await api.post("/board/cards", payload);
  return r.data;
}

async function remove(id: string) {
  log("remove(id)", id);
  if (!confirm(`[wjw] Delete card ${id}? This cannot be undone.`)) {
    log("remove(id) cancelled", id);
    return { cancelled: true };
  }
  const r = await api.delete(`/board/cards/${id}`);
  return r;
}

function open(id: string) {
  log("open(id)", id);
  navigate(`/card/${id}`);
}

function close() {
  log("close()");
  navigate("/");
}

export function installBridge() {
  const bridge = { cards, card, update, setDraft, note, move, duplicate, remove, open, close };
  (window as any).__wjw = bridge;
  log("bridge installed — window.__wjw ready", Object.keys(bridge));
  return bridge;
}
