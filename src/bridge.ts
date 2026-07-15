// In-app control bridge.
// Exposes a small, stable surface on `window.__wjw` so an external driver
// (Hermes agent, console, or any script in the page) can read and act on the
// live board without a backend, credentials, or network calls.
//
// `cards()` / `card(id)` read fresh state from a ref each call.
// Mutating actions (update/delete/move/open) go through the same React store
// the UI uses, so changes are reflected immediately and persisted.

import type { Card, CardStatus } from './types';

export interface BridgeApi {
  getCards: () => Card[];
  updateCard: (id: string, patch: Partial<Card>) => void;
  deleteCard: (id: string) => void;
  duplicateCard: (id: string) => void;
  moveCard: (id: string, status: CardStatus) => void;
  addCard: (card: Card) => void;
  openCard: (id: string) => void;
  closeCard: () => void;
}

function summarize(c: Card) {
  return {
    id: c.id,
    title: c.title,
    status: c.status,
    priority: c.priority,
    category: c.category,
    platforms: c.platforms,
    tags: c.tags,
    draftChars: (c.draft || '').length,
    mediaCount: c.media.length,
    resources: c.resources.map((r) => ({ title: r.title, url: r.url })),
    checklist: c.checklist,
    customFields: c.customFields,
    updatedAt: c.updatedAt,
  };
}

export function installBridge(api: BridgeApi) {
  const root = {
    /** All cards (condensed view). */
    cards: () => api.getCards().map(summarize),
    /** Full card object by id. */
    card: (id: string) => api.getCards().find((c) => c.id === id) ?? null,
    /** Patch a card (same fields as the UI edit form). */
    update: (id: string, patch: Partial<Card>) => {
      api.updateCard(id, patch);
      return root.card(id);
    },
    /** Append to a card's notes. */
    note: (id: string, text: string) => {
      const c = api.getCards().find((x) => x.id === id);
      if (!c) return null;
      const next = c.notes ? `${c.notes}\n\n${text}` : text;
      api.updateCard(id, { notes: next });
      return next;
    },
    /** Set / replace the draft (working copy) text. */
    setDraft: (id: string, text: string) => {
      api.updateCard(id, { draft: text });
      return text.length;
    },
    /** Move a card to another column. */
    move: (id: string, status: CardStatus) => api.moveCard(id, status),
    /** Duplicate a card. Returns the new card's id. */
    duplicate: (id: string) => {
      api.duplicateCard(id);
      return api.getCards()[0]?.id ?? null;
    },
    /** Delete a card by id. */
    remove: (id: string) => api.deleteCard(id),
    /** Open the card workspace in the UI. */
    open: (id: string) => api.openCard(id),
    /** Close any open card workspace. */
    close: () => api.closeCard(),
    /** Human-readable help. */
    help: () =>
      'window.__wjw: cards(), card(id), update(id,patch), setDraft(id,text), note(id,text), move(id,status), duplicate(id), remove(id), open(id), close(), help()',
  };

  (window as unknown as { __wjw: typeof root }).__wjw = root;
  return root;
}
