import type { Card } from './types';

export const STORAGE_KEY = 'wjw-kanban:v2';
export const APP_NAME = 'Wild Jazmine Wellness Planner';
export const APP_VERSION = '1.1.0';

export interface BackupManifest {
  app: string;
  version: string;
  schemaKey: string;
  exportedAt: string;
  cardCount: number;
  totalMedia: number;
  checksum: string;
  /** Self-contained instruction manual, regenerated on every backup. */
  manual: string;
  cards: Card[];
}

/** Small, stable 32-bit FNV-1a hash for a corruption check. */
function checksum(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export function buildBackup(cards: Card[], manual: string): BackupManifest {
  const raw = JSON.stringify(cards);
  const totalMedia = cards.reduce((n, c) => n + (c.media?.length || 0), 0);
  return {
    app: APP_NAME,
    version: APP_VERSION,
    schemaKey: STORAGE_KEY,
    exportedAt: new Date().toISOString(),
    cardCount: cards.length,
    totalMedia,
    checksum: checksum(raw),
    manual,
    cards,
  };
}

export function downloadBackup(cards: Card[], manual: string) {
  const manifest = buildBackup(cards, manual);
  const blob = new Blob([JSON.stringify(manifest, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `wjw-kanban-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  return manifest;
}

export interface RestoredBackup {
  cards: Card[];
  warnings: string[];
}

export async function readBackupFile(file: File): Promise<RestoredBackup> {
  const text = await file.text();
  const data = JSON.parse(text);
  const warnings: string[] = [];
  let cards: Card[] = [];

  if (Array.isArray(data)) {
    // Legacy flat export (pre-manifest).
    cards = data;
    warnings.push('Legacy flat export — no manifest, checksum not verified.');
  } else if (data && Array.isArray(data.cards)) {
    const manifest = data as BackupManifest;
    cards = manifest.cards;
    if (manifest.schemaKey && manifest.schemaKey !== STORAGE_KEY) {
      warnings.push(
        `Schema key differs (backup: ${manifest.schemaKey}, current: ${STORAGE_KEY}). Data is migrated on load.`,
      );
    }
    if (manifest.checksum) {
      const calc = checksum(JSON.stringify(cards));
      if (calc !== manifest.checksum) {
        warnings.push('Checksum mismatch — the file may be corrupted or partial.');
      }
    }
  } else {
    throw new Error('Unrecognized backup file.');
  }

  return { cards, warnings };
}
