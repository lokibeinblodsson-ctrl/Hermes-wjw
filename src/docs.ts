import {
  COLUMNS,
  CATEGORIES,
  PLATFORMS,
} from './types';
import { APP_NAME, APP_VERSION, STORAGE_KEY } from './storage';
import type { Card } from './types';

export interface DocSection {
  title: string;
  body: string;
}

const fieldTable = `| Field | What it holds |
| --- | --- |
| Title | Short label for the piece. |
| Description | One-paragraph summary. |
| Category | Thematic bucket (see list below). |
| Priority | low / medium / high. |
| Due date | Calendar date target. |
| Target week | ISO week, e.g. 2026-W28. |
| Platforms | Where it will be published. |
| Tags | Free keywords for filtering. |
| Content pillar | Themes grouping (e.g. Education). |
| Draft | The working copy / current text. |
| Checklist | Step-by-step todos for the piece. |
| Media | Images / videos stored in-browser. |
| Resources | Important links (websites, references) with notes. |
| Custom fields | Any other label/value info. |
| Notes | Free-form scratchpad. |`;

function manual(): string {
  return [
    '# Backup & Restore Manual',
    '',
    `**App:** ${APP_NAME}  `,
    `**Version:** ${APP_VERSION}  `,
    `**Generated:** ${new Date().toLocaleString()}`,
    '',
    '## How to back up',
    '1. Open the board and click **Backup** (top-right).',
    '2. A file downloads: `wjw-kanban-backup-YYYY-MM-DD.json`.',
    '3. Store it somewhere safe (your drive, email, cloud).',
    '4. The file is self-contained: it includes all cards, media (as data URLs),',
    '   and this manual. It also carries a checksum so you can detect corruption.',
    '',
    '## How to restore',
    '1. Click **Restore** (top-right) and choose a backup .json file.',
    '2. The board is replaced with the backup contents.',
    '3. Any checksum/schema warnings are shown — review them before continuing.',
    '',
    '## Where data lives',
    `All data is kept in this browser under localStorage key \`${STORAGE_KEY}\`.`,
    'There is no server. Clearing browser data for this site erases the board,',
    'so back up regularly.',
    '',
    '## Notes',
    '- Media is embedded as data URLs; large media makes the backup file big.',
    '- Restoring overwrites the current board. Export first if you want to keep it.',
  ].join('\n');
}

export function buildManual(): string {
  return manual();
}

export function buildDocs(cards: Card[]): DocSection[] {
  const byStatus = COLUMNS.map((c) => ({
    ...c,
    count: cards.filter((x) => x.status === c.id).length,
  }));
  const ready = cards.filter((c) => c.platformReady).length;
  const withMedia = cards.filter((c) => (c.media?.length || 0) > 0).length;
  const withResources = cards.filter((c) => (c.resources?.length || 0) > 0).length;

  return [
    {
      title: 'Overview',
      body:
        `${APP_NAME} is a content-planning kanban for Wild Jazmine Wellness ` +
        `(training, community, and education content).\n\n` +
        `Version ${APP_VERSION}. Data is stored locally in your browser ` +
        `(localStorage key \`${STORAGE_KEY}\`) — there is no server.\n\n` +
        `Current board: ${cards.length} cards · ${ready} marked platform-ready · ` +
        `${withMedia} with media · ${withResources} with resource links.`,
    },
    {
      title: 'Board columns (workflow)',
      body:
        'Cards move left-to-right as work progresses. Drag a card between columns.\n\n' +
        byStatus
          .map((c) => `- **${c.title}** (\`${c.id}\`) — ${c.count} card(s)`)
          .join('\n'),
    },
    {
      title: 'Categories',
      body: CATEGORIES.map((c) => `- ${c}`).join('\n'),
    },
    {
      title: 'Platforms',
      body:
        'These are the destinations a piece can target. Publishing is currently a ' +
        'handoff workflow (no auto-posting yet).\n\n' +
        PLATFORMS.map((p) => `- ${p}`).join('\n'),
    },
    {
      title: 'Card fields',
      body:
        'Each card holds the following. The full-page workspace (click a card) ' +
        'lets you edit all of them.\n\n' +
        fieldTable,
    },
    {
      title: 'Opening a card (creation page)',
      body:
        'Click any card on the board to open its full-page workspace:\n' +
        '- **Draft** tab — the working copy / current text.\n' +
        '- **Media** tab — add images/videos (stored in-browser).\n' +
        '- **Resources** tab — important links with optional notes.\n' +
        '- **Checklist** tab — steps to complete the piece.\n' +
        '- **Details** tab — custom label/value fields for anything else.\n' +
        '- **Notes** tab — free-form scratchpad.\n' +
        'Everything autosaves. Use the status dropdown to move the card, ' +
        'or Duplicate / Delete from the top bar.',
    },
    {
      title: 'Toolbar & data',
      body:
        'The toolbar filters by search, category, platform, priority, and sort.\n' +
        '- **Export** downloads cards as JSON.\n' +
        '- **Import** replaces the board from a JSON file.\n' +
        '- **Reset** reloads the starter cards (replaces current board).\n' +
        '- **Backup** downloads a self-contained backup with this manual.\n' +
        '- **Restore** loads a backup file.',
    },
    {
      title: 'Backup & restore',
      body: manual(),
    },
    {
      title: 'For your assistant (window.__wjw bridge)',
      body:
        'A control bridge is exposed on `window.__wjw` so an external driver can ' +
        'read and act on the live board without a backend:\n' +
        '- `window.__wjw.cards()` — list all cards (condensed).\n' +
        '- `window.__wjw.card(id)` — full card object.\n' +
        '- `window.__wjw.update(id, patch)` — edit fields.\n' +
        '- `window.__wjw.setDraft(id, text)` — set the working copy.\n' +
        '- `window.__wjw.note(id, text)` — append a note.\n' +
        '- `window.__wjw.move(id, status)` — move a card.\n' +
        '- `window.__wjw.open(id)` / `close()` — open/close the workspace.\n' +
        '- `window.__wjw.duplicate(id)` / `remove(id)` — duplicate/delete.',
    },
  ];
}
