import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import type { Card, CardStatus } from './types';
import { COLUMNS } from './types';
import { useBoard } from './store';
import { seedCards } from './sampleData';
import { Column } from './components/Column';
import { CardModal } from './components/CardModal';
import { CardWorkspace } from './components/CardWorkspace';
import { Toolbar, type Filters } from './components/Toolbar';
import { Analytics } from './components/Analytics';
import { emptyCard, sortCards } from './components/helpers';
import { installBridge } from './bridge';
import { DocsPage } from './components/DocsPage';
import { downloadBackup, readBackupFile } from './storage';
import { buildManual } from './docs';
import { Login } from './components/Login';
import { ChatPanel } from './components/ChatPanel';
import {
  getToken,
  setToken,
  me,
  loadBoard,
  saveBoard,
  type AuthUser,
} from './api';

export default function App() {
  const board = useBoard();
  const [filters, setFilters] = useState<Filters>({
    search: '',
    category: '',
    platform: '',
    priority: '',
    sortBy: 'recent',
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Card | null>(null);
  const [workspace, setWorkspace] = useState<Card | null>(null);
  const [showAnalytics, setShowAnalytics] = useState(true);
  const [showDocs, setShowDocs] = useState(false);
  const [showChat, setShowChat] = useState(false);

  // --- Auth + networking ---
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [synced, setSynced] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const saveTimer = useRef<number | null>(null);

  // On mount: restore session if token exists.
  useEffect(() => {
    const tok = getToken();
    if (!tok) {
      setAuthChecked(true);
      return;
    }
    me()
      .then(({ user }) => {
        setUser(user);
        setAuthChecked(true);
      })
      .catch(() => {
        setToken(null);
        setAuthChecked(true);
      });
  }, []);

  // When authenticated, load board + open live sync.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    loadBoard()
      .then(async (cards) => {
        if (cancelled) return;
        let initial = cards as Card[];
        // First team login: seed the server board with starter content.
        if (!initial || initial.length === 0) {
          initial = seedCards();
          try {
            await saveBoard(initial);
          } catch {
            /* ignore */
          }
        }
        board.replaceAll(initial);
        setSynced(true);
      })
      .catch(() => setSynced(false));

    const tok = getToken();
    const ws = new WebSocket(`/ws?token=${tok}`);
    wsRef.current = ws;
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'board' && Array.isArray(msg.cards)) {
          // update without echoing back (server already saved it)
          if (wsRef.current && wsRef.current.readyState === 1) {
            // mark as remote origin to avoid re-broadcast
          }
          board.replaceAll(msg.cards as Card[]);
        }
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => setSynced(false);

    return () => {
      cancelled = true;
      ws.close();
    };
  }, [user, board]);

  // Autosave to server (debounced) + broadcast over WS.
  const persist = useCallback(
    (cards: Card[]) => {
      if (!user) return;
      setSaving(true);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(async () => {
        try {
          await saveBoard(cards);
          // broadcast to peers
          if (wsRef.current && wsRef.current.readyState === 1) {
            wsRef.current.send(JSON.stringify({ type: 'board', cards }));
          }
        } catch {
          /* ignore */
        } finally {
          setSaving(false);
        }
      }, 400);
    },
    [user],
  );

  // Hook board changes -> persist.
  const initialSync = useRef(false);
  useEffect(() => {
    if (!user || !synced) return;
    if (!initialSync.current) {
      initialSync.current = true;
      return; // skip the first load-triggered change
    }
    persist(board.cards);
  }, [board.cards, user, synced, persist]);

  const onAuth = (u: AuthUser, token: string) => {
    setToken(token);
    setUser(u);
  };

  const onLogout = () => {
    setToken(null);
    setUser(null);
    if (wsRef.current) wsRef.current.close();
  };

  const openCard = (id: string) => {
    const c = board.cards.find((x) => x.id === id) ?? null;
    setWorkspace(c);
  };
  const closeCard = () => setWorkspace(null);

  if (!(window as unknown as { __wjwInstalled?: boolean }).__wjwInstalled) {
    installBridge({
      getCards: () => board.cards,
      updateCard: board.updateCard,
      deleteCard: board.deleteCard,
      duplicateCard: board.duplicateCard,
      moveCard: board.moveCard,
      addCard: board.addCard,
      openCard,
      closeCard,
    });
    (window as unknown as { __wjwInstalled?: boolean }).__wjwInstalled = true;
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return board.cards.filter((c) => {
      if (q && !`${c.title} ${c.description}`.toLowerCase().includes(q)) return false;
      if (filters.category && c.category !== filters.category) return false;
      if (filters.platform && !c.platforms.includes(filters.platform)) return false;
      if (filters.priority && c.priority !== filters.priority) return false;
      return true;
    });
  }, [board.cards, filters]);

  const cardsByCol = useMemo(() => {
    const map: Record<CardStatus, Card[]> = {
      ideas: [],
      'needs-info': [],
      'in-progress': [],
      'draft-ready': [],
      scheduled: [],
      archived: [],
    };
    for (const c of filtered) {
      const key = (c.status ?? 'ideas') as CardStatus;
      if (!map[key]) map[key] = [];
      map[key].push(c);
    }
    for (const k of Object.keys(map) as CardStatus[]) {
      map[k] = sortCards(map[k], filters.sortBy);
    }
    return map;
  }, [filtered, filters.sortBy]);

  const activeCard = activeId
    ? board.cards.find((c) => c.id === activeId) ?? null
    : null;

  const liveWorkspace = workspace
    ? board.cards.find((c) => c.id === workspace.id) ?? null
    : null;

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const overId = String(over.id);
    const status = (COLUMNS.find((c) => c.id === overId)?.id ??
      (over.data.current as { status?: CardStatus })?.status ??
      null) as CardStatus | null;
    if (status) board.moveCard(String(active.id), status);
  }

  function onAdd(status: CardStatus) {
    const card = emptyCard(status);
    setEditing(card);
  }

  function onSave(patch: Partial<Card>) {
    if (editing && board.cards.some((c) => c.id === editing.id)) {
      board.updateCard(editing.id, patch);
    } else if (editing) {
      board.addCard({ ...editing, ...patch } as Card);
    }
    setEditing(null);
  }

  function onWorkspacePatch(patch: Partial<Card>) {
    if (workspace) board.updateCard(workspace.id, patch);
  }

  function onDelete() {
    if (editing) board.deleteCard(editing.id);
    setEditing(null);
  }

  function onDuplicate() {
    if (editing) board.duplicateCard(editing.id);
    setEditing(null);
  }

  function onExport() {
    const blob = new Blob([JSON.stringify(board.cards, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wjw-kanban-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function onBackup() {
    downloadBackup(board.cards, buildManual());
  }

  async function onRestore(file: File) {
    try {
      const { cards, warnings } = await readBackupFile(file);
      if (warnings.length && !confirm(`${warnings.join('\n\n')}\n\nReplace the current board?`)) {
        return;
      }
      board.replaceAll(cards);
    } catch (e) {
      alert(`Could not restore: ${e instanceof Error ? e.message : 'invalid file'}`);
    }
  }

  function onImport(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as Card[];
        if (Array.isArray(parsed)) board.replaceAll(parsed);
      } catch {
        alert('Could not import: invalid JSON.');
      }
    };
    reader.readAsText(file);
  }

  if (!authChecked) {
    return <div className="flex min-h-screen items-center justify-center bg-paper text-charcoal-soft">Loading…</div>;
  }

  if (!user) {
    return <Login onAuth={onAuth} />;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between bg-charcoal px-4 py-3 text-paper">
        <div>
          <h1 className="text-base font-semibold leading-tight">Wild Jazmine Wellness</h1>
          <p className="text-[11px] text-paper/70">Content · Training · Community planner</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowChat((s) => !s)}
            className={`rounded-md px-3 py-1.5 text-xs hover:bg-paper/20 ${showChat ? 'bg-paper/20' : 'bg-paper/10'}`}
          >
            Chat {synced ? '●' : '○'}
          </button>
          <button
            onClick={() => setShowDocs(true)}
            className="rounded-md bg-paper/10 px-3 py-1.5 text-xs hover:bg-paper/20"
          >
            Docs
          </button>
          <button
            onClick={onBackup}
            className="rounded-md bg-paper/10 px-3 py-1.5 text-xs hover:bg-paper/20"
          >
            Backup
          </button>
          <label className="cursor-pointer rounded-md bg-paper/10 px-3 py-1.5 text-xs hover:bg-paper/20">
            Restore
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onRestore(f);
                e.currentTarget.value = '';
              }}
            />
          </label>
          <button
            onClick={() => setShowAnalytics((s) => !s)}
            className="rounded-md bg-paper/10 px-3 py-1.5 text-xs hover:bg-paper/20"
          >
            {showAnalytics ? 'Hide analytics' : 'Show analytics'}
          </button>
          <span className="rounded-md bg-paper/10 px-3 py-1.5 text-xs">
            {user.displayName}
          </span>
          <button
            onClick={onLogout}
            className="rounded-md bg-paper/10 px-3 py-1.5 text-xs hover:bg-paper/20"
          >
            Log out
          </button>
        </div>
      </header>

      <Toolbar
        filters={filters}
        setFilters={setFilters}
        onExport={onExport}
        onImport={onImport}
        onResetSeed={() => {
          if (confirm('Reload starter cards? This replaces current board (for everyone).'))
            board.resetSeed();
        }}
      />

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <div className="flex flex-1 gap-4 overflow-x-auto p-4">
          <div className="flex gap-4">
            {COLUMNS.map((col) => (
              <Column
                key={col.id}
                id={col.id}
                title={col.title}
                accent={col.accent}
                cards={cardsByCol[col.id]}
                onOpen={(id) => openCard(id)}
                onAdd={onAdd}
              />
            ))}
          </div>
          {showAnalytics && <Analytics cards={board.cards} />}
        </div>

        <DragOverlay>
          {activeCard ? (
            <div className="w-72 rotate-2 rounded-lg border border-dusty-deep bg-white p-3 text-sm shadow-xl">
              {activeCard.title}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {liveWorkspace && (
        <CardWorkspace
          card={liveWorkspace}
          onClose={() => setWorkspace(null)}
          onPatch={onWorkspacePatch}
          onSave={() => setWorkspace(null)}
          onDelete={() => {
            board.deleteCard(liveWorkspace.id);
            setWorkspace(null);
          }}
          onDuplicate={() => {
            board.duplicateCard(liveWorkspace.id);
            setWorkspace(null);
          }}
        />
      )}

      {editing && (
        <CardModal
          card={editing}
          onClose={() => setEditing(null)}
          onSave={onSave}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
        />
      )}

      {showDocs && <DocsPage cards={board.cards} onClose={() => setShowDocs(false)} />}

      {showChat && (
        <div className="fixed bottom-0 right-0 top-0 z-40 w-full max-w-sm border-l border-beige-deep/60 bg-paper shadow-2xl">
          <ChatPanel cards={board.cards} user={user} />
        </div>
      )}

      {saving && (
        <div className="fixed bottom-3 left-3 z-30 rounded-md bg-charcoal/80 px-2 py-1 text-[10px] text-paper">
          saving…
        </div>
      )}
    </div>
  );
}
