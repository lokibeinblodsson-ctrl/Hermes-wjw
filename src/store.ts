import { useEffect, useState, useCallback } from 'react';
import type { Card } from './types';
import { seedCards } from './sampleData';
import { STORAGE_KEY } from './storage';

// Backfill new fields onto cards loaded from older saves / the server
// so the UI never reads `undefined`.
export function backfill(c: Card): Card {
  return {
    ...c,
    status: c.status ?? 'ideas',
    category: c.category ?? '',
    platforms: c.platforms ?? [],
    priority: c.priority ?? 'medium',
    dueDate: c.dueDate ?? '',
    targetWeek: c.targetWeek ?? '',
    tags: c.tags ?? [],
    links: c.links ?? [],
    notes: c.notes ?? '',
    contentPillar: c.contentPillar ?? '',
    platformReady: c.platformReady ?? false,
    draft: c.draft ?? '',
    checklist: c.checklist ?? [],
    media: c.media ?? [],
    resources: c.resources ?? [],
    customFields: c.customFields ?? [],
    createdAt: c.createdAt ?? new Date().toISOString(),
    updatedAt: c.updatedAt ?? new Date().toISOString(),
  };
}

function load(): Card[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedCards();
    const parsed = JSON.parse(raw) as Card[];
    if (!Array.isArray(parsed) || parsed.length === 0) return seedCards();
    return parsed.map(backfill);
  } catch {
    return seedCards();
  }
}

export function useBoard() {
  const [cards, setCards] = useState<Card[]>(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
    } catch {
      /* ignore quota errors */
    }
  }, [cards]);

  const addCard = useCallback((card: Card) => {
    setCards((prev) => [card, ...prev]);
  }, []);

  const updateCard = useCallback((id: string, patch: Partial<Card>) => {
    setCards((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, ...patch, updatedAt: new Date().toISOString() } : c,
      ),
    );
  }, []);

  const deleteCard = useCallback((id: string) => {
    setCards((prev) => prev.filter((c) => c.id !== id));
  }, []);

  const duplicateCard = useCallback((id: string) => {
    setCards((prev) => {
      const src = prev.find((c) => c.id === id);
      if (!src) return prev;
      const copy: Card = {
        ...src,
        id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        title: `${src.title} (copy)`,
        status: 'ideas',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        platformReady: false,
      };
      return [copy, ...prev];
    });
  }, []);

  const moveCard = useCallback((id: string, status: Card['status']) => {
    setCards((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, status, updatedAt: new Date().toISOString() } : c,
      ),
    );
  }, []);

  const replaceAll = useCallback(
    (next: Card[]) => setCards(next.map(backfill)),
    [],
  );

  const resetSeed = useCallback(() => setCards(seedCards()), []);

  return {
    cards,
    addCard,
    updateCard,
    deleteCard,
    duplicateCard,
    moveCard,
    replaceAll,
    resetSeed,
  };
}
