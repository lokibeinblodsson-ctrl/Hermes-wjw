// Types for the Wild Jazmine Wellness content-planning kanban.
export type CardStatus =
  | 'ideas'
  | 'needs-info'
  | 'in-progress'
  | 'draft-ready'
  | 'scheduled'
  | 'archived';

export const COLUMNS: { id: CardStatus; title: string; accent: string }[] = [
  { id: 'ideas', title: 'Ideas', accent: '#a8c0c2' }, // dusty blue
  { id: 'needs-info', title: 'Needs More Info', accent: '#d8c3a5' }, // soft beige
  { id: 'in-progress', title: 'In Progress', accent: '#b7c9a8' }, // sage
  { id: 'draft-ready', title: 'Draft Ready', accent: '#9fb89a' }, // deeper sage
  { id: 'scheduled', title: 'Scheduled / Posted', accent: '#8aa39b' }, // muted teal
  { id: 'archived', title: 'Archived', accent: '#c9c2b6' }, // warm grey
];

export const CATEGORIES = [
  'EFT / EFCT',
  'EFW',
  'Substance Use',
  'Identity / LGBTQ+',
  'Neurodivergence',
  'Workshops',
  'Group Offers',
  'Practicum / Training Milestones',
  'Professional Education',
  'Personal Reflection',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const PLATFORMS = [
  'Instagram',
  'Facebook',
  'TikTok',
  'Newsletter',
  'Blog',
  'YouTube',
  'LinkedIn',
  'Website',
] as const;
export type Platform = (typeof PLATFORMS)[number];

export type Priority = 'low' | 'medium' | 'high';

export interface MediaItem {
  id: string;
  name: string;
  kind: 'image' | 'video' | 'file';
  type: string;
  dataUrl: string; // persisted as a data URL in localStorage
  size: number;
}

export interface ResourceLink {
  id: string;
  title: string;
  url: string;
  note?: string;
}

export interface CustomField {
  id: string;
  label: string;
  value: string;
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface Card {
  id: string;
  title: string;
  description: string;
  category: Category | '';
  platforms: Platform[];
  priority: Priority;
  status: CardStatus;
  dueDate: string; // ISO date or ''
  targetWeek: string; // e.g. "2026-W12" or ''
  tags: string[];
  links: string[];
  notes: string;
  contentPillar?: string;
  platformReady?: boolean;
  draft: string; // current working copy / draft content
  checklist: ChecklistItem[];
  media: MediaItem[];
  resources: ResourceLink[];
  customFields: CustomField[];
  createdAt: string;
  updatedAt: string;
}

export const PRIORITY_RANK: Record<Priority, number> = { high: 3, medium: 2, low: 1 };
