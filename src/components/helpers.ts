import { type Card, PRIORITY_RANK } from '../types';

export function priorityColor(p: Card['priority']): string {
  switch (p) {
    case 'high':
      return '#c98b7a'; // muted terracotta
    case 'medium':
      return '#d8c3a5'; // beige
    default:
      return '#b7c9a8'; // sage
  }
}

export function uid(): string {
  return `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function emptyCard(status: Card['status']): Card {
  const now = new Date().toISOString();
  return {
    id: uid(),
    title: '',
    description: '',
    category: '',
    platforms: [],
    priority: 'medium',
    status,
    dueDate: '',
    targetWeek: '',
    tags: [],
    links: [],
    notes: '',
    contentPillar: '',
    platformReady: false,
    draft: '',
    checklist: [],
    media: [],
    resources: [],
    customFields: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function sortCards(
  cards: Card[],
  sortBy: 'priority' | 'dueDate' | 'recent',
): Card[] {
  const arr = [...cards];
  if (sortBy === 'priority') {
    arr.sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]);
  } else if (sortBy === 'dueDate') {
    arr.sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  } else {
    arr.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  return arr;
}
