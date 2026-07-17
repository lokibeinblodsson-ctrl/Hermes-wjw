// Global command palette: keyboard-first navigation + quick actions for the
// whole app. Mounted once in App.tsx so it works from any screen.
//
// Design notes:
// - Reuses existing routes/APIs; does NOT duplicate server-side search. The
//   board and files endpoints already support a `q` param (LIKE search), so we
//   pass the query straight through. Channels/docs have no server search, so we
//   fetch them once and fuzzy-match client-side.
// - Calm styling lives in app/styles.css (.cmd-palette*). No bright blue.
// - Shortcut: Cmd/Ctrl+K to open from anywhere; Esc to close; ↑/↓ to move;
//   Enter to execute.
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { api, getToken } from "../lib/api";
import { useAuth } from "../App";

type Group = "Actions" | "Cards" | "Files" | "Chat" | "Docs" | "Admin" | "Pages";

interface Cmd {
  id: string;
  group: Group;
  title: string;
  subtitle?: string;
  icon?: string;
  keywords?: string;
  perform: () => void;
}

// ── Fuzzy subsequence matcher ───────────────────────────────────────────────
// Returns a score (higher = better) or -1 for no match. Rewards contiguous
// runs and start-of-word matches so short queries feel precise.
function fuzzyScore(query: string, text: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  let score = 0;
  let run = 0;
  let prevMatchIdx = -2;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      let bonus = 1;
      if (ti === prevMatchIdx + 1) { run++; bonus += run * 2; } else { run = 0; }
      if (ti === 0 || t[ti - 1] === " " || t[ti - 1] === "-" || t[ti - 1] === "_") bonus += 3;
      score += bonus;
      prevMatchIdx = ti;
      qi++;
    }
  }
  if (qi < q.length) return -1; // not all query chars matched
  // Prefer shorter targets and earlier first match.
  return score - t.length * 0.01;
}

function matchCmd(cmd: Cmd, query: string): number {
  if (!query) return 0;
  const hay = [cmd.title, cmd.subtitle || "", cmd.keywords || "", cmd.group].join(" ");
  return fuzzyScore(query, hay);
}

export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [cards, setCards] = useState<Cmd[]>([]);
  const [files, setFiles] = useState<Cmd[]>([]);
  const [channels, setChannels] = useState<Cmd[]>([]);
  const [docs, setDocs] = useState<Cmd[]>([]);
  const [docsLoaded, setDocsLoaded] = useState(false);
  const [loadingLive, setLoadingLive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const reqId = useRef(0);

  const canManage = user?.role === "admin" || user?.role === "moderator";
  const canReview = canManage || user?.role === "reviewer";

  // ── Static commands (navigation + quick actions), rebuilt when auth changes.
  const staticCmds = useMemo<Cmd[]>(() => {
    const go = (path: string) => () => { navigate(path); onClose(); };
    const pages: Cmd[] = [
      { id: "nav-board", group: "Pages", title: "Board", subtitle: "Kanban board", icon: "▦", keywords: "kanban home cards", perform: go("/") },
      { id: "nav-chat", group: "Pages", title: "Chat", subtitle: "Team chat", icon: "💬", keywords: "messages threads", perform: go("/chat") },
      { id: "nav-calendar", group: "Pages", title: "Calendar", subtitle: "Content calendar", icon: "📅", keywords: "schedule publishing dates", perform: go("/calendar") },
      { id: "nav-memory", group: "Pages", title: "Memory", subtitle: "RAG knowledge", icon: "🧠", keywords: "notes facts decisions", perform: go("/memory") },
      { id: "nav-docs", group: "Pages", title: "Docs", subtitle: "Live documentation", icon: "📖", keywords: "help reference guide", perform: go("/docs") },
      { id: "nav-activity", group: "Pages", title: "Activity", subtitle: "Recent activity & events", icon: "📈", keywords: "audit logs feed", perform: go("/activity") },
    ];
    if (canReview) pages.push({ id: "nav-publish", group: "Pages", title: "Publishing", subtitle: "Content pipeline", icon: "🚀", keywords: "queue draft review", perform: go("/publish") });
    if (canManage) pages.push({ id: "nav-files", group: "Pages", title: "Files", subtitle: "Files & assets", icon: "📁", keywords: "uploads pdf images", perform: go("/files") });
    if (canManage) pages.push({ id: "nav-admin", group: "Pages", title: "Admin", subtitle: "Admin console", icon: "🛡", keywords: "users settings audit", perform: go("/admin") });

    const actions: Cmd[] = [
      { id: "act-newcard", group: "Actions", title: "Create card", subtitle: "Open the board with a new-card form", icon: "＋", keywords: "new add task", perform: go("/?newcard=1") },
      { id: "act-board", group: "Actions", title: "Open board", icon: "▦", keywords: "kanban", perform: go("/") },
      { id: "act-docs", group: "Actions", title: "Open docs", icon: "📖", keywords: "documentation help", perform: go("/docs") },
      { id: "act-calendar", group: "Actions", title: "Open calendar", icon: "📅", keywords: "schedule", perform: go("/calendar") },
      { id: "act-activity", group: "Actions", title: "Open activity center", icon: "📈", keywords: "feed audit", perform: go("/activity") },
      { id: "act-hermes", group: "Actions", title: "Toggle Hermes assistant", icon: "🌿", keywords: "ai chat help", perform: () => { window.dispatchEvent(new CustomEvent("wjw:toggle-hermes")); onClose(); } },
    ];
    if (canReview) actions.push({ id: "act-publish", group: "Actions", title: "Open publishing queue", icon: "🚀", keywords: "drafts pipeline", perform: go("/publish?view=queue") });
    if (canReview) actions.push({ id: "act-review", group: "Actions", title: "Open review queue", icon: "🔍", keywords: "approve reject pending", perform: go("/publish?view=review") });
    if (canManage) actions.push({ id: "act-files", group: "Actions", title: "Open files", icon: "📁", keywords: "uploads", perform: go("/files") });
    if (canManage) actions.push({ id: "act-admin", group: "Actions", title: "Open admin", icon: "🛡", keywords: "console settings", perform: go("/admin") });

    // Admin sub-sections (jump straight to a tab).
    const adminSections: Cmd[] = (["users", "tasks", "categories", "audit", "analytics", "flags", "settings", "data"] as const)
      .filter((t) => t !== "data" || canManage)
      .map((t) => ({
        id: `admin-${t}`, group: "Admin" as Group, title: `Admin · ${t}`,
        subtitle: "Admin console section", icon: "🛡", keywords: `admin ${t}`, perform: go(`/admin?tab=${t}`),
      }));

    // Calendar / publishing views.
    const views: Cmd[] = [
      { id: "view-cal", group: "Pages", title: "Calendar view", subtitle: "Month grid", icon: "📅", keywords: "schedule", perform: go("/calendar") },
    ];
    if (canReview) {
      views.push({ id: "view-review", group: "Pages", title: "Review queue", subtitle: "Items pending review", icon: "🔍", keywords: "approve reject", perform: go("/publish?view=review") });
      views.push({ id: "view-pubqueue", group: "Pages", title: "Publishing queue", subtitle: "All pipeline items", icon: "🚀", keywords: "drafts", perform: go("/publish?view=queue") });
    }

    return [...actions, ...pages, ...views, ...adminSections];
  }, [canManage, canReview, navigate, onClose]);

  // ── Live search: cards + files via server `q`; channels + docs client-side.
  const runLiveSearch = useCallback(async (q: string) => {
    if (!getToken()) return;
    const myReq = ++reqId.current;
    setLoadingLive(true);
    try {
      const [cardRes, fileRes] = await Promise.all([
        api.get(`/board/cards?q=${encodeURIComponent(q)}&sort=position`).catch(() => null),
        api.get(`/files?q=${encodeURIComponent(q)}`).catch(() => null),
      ]);
      if (myReq !== reqId.current) return;
      const cardCmds: Cmd[] = ((cardRes?.data) || []).slice(0, 12).map((c: any) => ({
        id: `card-${c.id}`, group: "Cards" as Group, title: c.title,
        subtitle: [c.category_name, c.priority, c.assignee_name].filter(Boolean).join(" · ") || "card",
        icon: "▦", keywords: `${c.title} ${c.tags?.join(" ") || ""}`,
        perform: () => { navigate(`/card/${c.id}`); onClose(); },
      }));
      const fileCmds: Cmd[] = ((fileRes?.data) || []).slice(0, 12).map((f: any) => ({
        id: `file-${f.id}`, group: "Files" as Group, title: f.name,
        subtitle: [f.kind, f.note].filter(Boolean).join(" · ") || "file",
        icon: "📁", keywords: `${f.name} ${f.tags?.join(" ") || ""}`,
        perform: () => { navigate(`/files`); onClose(); },
      }));
      setCards(cardCmds);
      setFiles(fileCmds);
    } catch {
      if (myReq === reqId.current) { setCards([]); setFiles([]); }
    } finally {
      if (myReq === reqId.current) setLoadingLive(false);
    }
  }, [navigate, onClose]);

  // Channels: fetch once, fuzzy client-side.
  const loadChannels = useCallback(async () => {
    if (!getToken() || channels.length) return;
    try {
      const r = await api.get("/chat/channels");
      setChannels(((r.data) || []).map((ch: any) => ({
        id: `chan-${ch.id}`, group: "Chat" as Group, title: `# ${ch.name}`,
        subtitle: ch.description || "channel", icon: "💬", keywords: `${ch.name} ${ch.description || ""}`,
        perform: () => { navigate(`/chat?channel=${ch.id}`); onClose(); },
      })));
    } catch { /* ignore */ }
  }, [channels.length, navigate, onClose]);

  // Docs: fetch once, build searchable entries from named entities.
  const loadDocs = useCallback(async () => {
    if (!getToken() || docsLoaded) return;
    try {
      const r = await api.get("/docs");
      const d = r.data?.data;
      const entries: Cmd[] = [];
      if (d) {
        (d.columns || []).forEach((c: any) => entries.push({ id: `doc-col-${c.id}`, group: "Docs" as Group, title: `Docs · column "${c.name}"`, subtitle: `${c.card_count} cards`, icon: "📖", keywords: `doc column ${c.name}`, perform: () => { navigate("/docs"); onClose(); } }));
        (d.categories || []).forEach((c: any) => entries.push({ id: `doc-cat-${c.id}`, group: "Docs" as Group, title: `Docs · category "${c.name}"`, subtitle: c.description || "", icon: "📖", keywords: `doc category ${c.name}`, perform: () => { navigate("/docs"); onClose(); } }));
        (d.platforms || []).forEach((p: string) => entries.push({ id: `doc-plat-${p}`, group: "Docs" as Group, title: `Docs · platform ${p}`, subtitle: "Publishing platform", icon: "📖", keywords: `doc platform ${p}`, perform: () => { navigate("/docs"); onClose(); } }));
      }
      setDocs(entries);
      setDocsLoaded(true);
    } catch { setDocsLoaded(true); }
  }, [docsLoaded, navigate, onClose]);

  // Trigger live search (debounced) when query changes.
  useEffect(() => {
    if (!open) return;
    if (query.trim().length >= 2) {
      const t = setTimeout(() => runLiveSearch(query.trim()), 120);
      return () => clearTimeout(t);
    } else {
      setCards([]); setFiles([]);
    }
  }, [open, query, runLiveSearch]);

  useEffect(() => {
    if (!open) return;
    loadChannels();
    loadDocs();
  }, [open, loadChannels, loadDocs]);

  // Reset + focus when opened.
  useEffect(() => {
    if (open) {
      setQuery("");
      setCards([]); setFiles([]); setActive(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // ── Build + rank the visible list.
  const results = useMemo<Cmd[]>(() => {
    const q = query.trim();
    const live: Cmd[] = [...cards, ...files, ...channels, ...docs];
    const all = [...staticCmds, ...live];
    const scored = all
      .map((c) => ({ c, s: matchCmd(c, q) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => {
        // When searching, rank by score then group order; empty query lists
        // Actions + Pages first (a useful default menu).
        if (q) {
          if (b.s !== a.s) return b.s - a.s;
        }
        const groupOrder: Group[] = ["Actions", "Cards", "Files", "Chat", "Docs", "Admin", "Pages"];
        return groupOrder.indexOf(a.c.group) - groupOrder.indexOf(b.c.group);
      });
    return scored.map((x) => x.c);
  }, [query, staticCmds, cards, files, channels, docs]);

  // Keep active index in range as results change.
  useEffect(() => { if (active >= results.length) setActive(0); }, [results.length, active]);

  // Scroll active item into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(results.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const cmd = results[active];
      if (cmd) cmd.perform();
    }
  }

  // Group results for rendering.
  const groups: Group[] = ["Actions", "Cards", "Files", "Chat", "Docs", "Admin", "Pages"];
  let renderIdx = 0;
  const grouped = groups
    .map((g) => {
      const items = results.filter((c) => c.group === g);
      return { g, items };
    })
    .filter((x) => x.items.length > 0);

  return (
    <div className="cmd-backdrop" onMouseDown={onClose} role="presentation">
      <div className="cmd-palette" role="dialog" aria-label="Command palette" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cmd-input-row">
          <span className="cmd-prompt" aria-hidden>⌘</span>
          <input
            ref={inputRef}
            className="cmd-input"
            placeholder="Search cards, files, chats, pages…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={onKeyDown}
            aria-label="Command palette search"
            autoComplete="off"
            spellCheck={false}
          />
          {loadingLive && <span className="cmd-spin" aria-hidden>…</span>}
          <kbd className="cmd-kbd">esc</kbd>
        </div>
        <div className="cmd-results" ref={listRef}>
          {results.length === 0 && (
            <div className="cmd-empty">{query.trim() ? "No matches" : "Type to search, or pick a page below"}</div>
          )}
          {grouped.map(({ g, items }) => (
            <div className="cmd-group" key={g}>
              <div className="cmd-group-label">{g}</div>
              {items.map((c) => {
                const idx = renderIdx++;
                return (
                  <button
                    key={c.id}
                    data-idx={idx}
                    className={`cmd-item ${idx === active ? "active" : ""}`}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => c.perform()}
                  >
                    <span className="cmd-icon" aria-hidden>{c.icon || "•"}</span>
                    <span className="cmd-text">
                      <span className="cmd-title">{c.title}</span>
                      {c.subtitle && <span className="cmd-sub">{c.subtitle}</span>}
                    </span>
                    <span className="cmd-group-tag">{c.group}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="cmd-foot">
          <span><kbd className="cmd-kbd">↑</kbd><kbd className="cmd-kbd">↓</kbd> navigate</span>
          <span><kbd className="cmd-kbd">↵</kbd> open</span>
          <span><kbd className="cmd-kbd">esc</kbd> close</span>
          <span className="cmd-hint">⌘/Ctrl + K to open anywhere</span>
        </div>
      </div>
    </div>
  );
}
