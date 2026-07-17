// Shared application metadata + constants surfaced by the docs, backup/restore,
// and seed features. Keeping these in one place means the docs page and backup
// format stay in sync with the real model.
import type { D1Database } from "@cloudflare/workers-types";
import { sha256HexAsync } from "./crypto";

export const APP_NAME = "Wild Jazmine Wellness";
export const APP_VERSION = "1.0.0";
// Bumped independently when the backup JSON shape changes.
export const BACKUP_SCHEMA_VERSION = 2;

// Default board columns (mirrors bootstrap.ts seed order). Used by docs when the
// live DB has not been queried, and as a reference list.
export const DEFAULT_COLUMNS = ["Backlog", "To Do", "In Progress", "Review", "Done"];

// The first ("ideas") column name used for seeding sample cards. The board's
// first column by position is treated as the ideas column.
export const IDEAS_COLUMN_HINT = "Backlog";

// Platforms content can be targeted at. Live config surface for the docs page
// and the card workspace platform picker.
export const PLATFORMS = [
  "Instagram",
  "Facebook",
  "LinkedIn",
  "TikTok",
  "YouTube",
  "Newsletter",
  "Blog",
  "Website",
];

// Card field reference — the canonical description of the (extended) card model,
// surfaced live in the docs page so it never drifts from the schema.
export interface CardFieldDoc {
  name: string;
  type: string;
  description: string;
}
export const CARD_FIELDS: CardFieldDoc[] = [
  { name: "title", type: "text", description: "Card title (required)." },
  { name: "description", type: "text", description: "Short summary of the card." },
  { name: "priority", type: "enum", description: "low | medium | high | urgent." },
  { name: "due_date", type: "date", description: "Optional ISO due date." },
  { name: "category_id", type: "ref", description: "Category this card belongs to." },
  { name: "tags", type: "json", description: "Array of free-form tag strings." },
  { name: "assignee_id", type: "ref", description: "User the card is assigned to." },
  { name: "draft", type: "text", description: "Working content draft (Draft tab)." },
  { name: "checklist", type: "json", description: "Array of {id,text,done} task items." },
  { name: "media", type: "json", description: "Array of {id,url,type,name} media items." },
  { name: "resources", type: "json", description: "Array of {id,label,url,notes} links." },
  { name: "custom_fields", type: "json", description: "Array of {id,label,value} custom fields." },
  { name: "notes", type: "text", description: "Freeform notes / instructions for Hermes." },
  { name: "content_pillar", type: "text", description: "Content pillar label." },
  { name: "platform_ready", type: "bool", description: "Whether the card is ready to publish." },
  { name: "platforms", type: "json", description: "Target platform labels for this card." },
  { name: "research_page_id", type: "ref", description: "Optional linked research page id." },
];

// Canonical, order-independent JSON stringify (sorted keys, recursive). Used so
// the backup checksum is stable regardless of key/property ordering.
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

// Checksum over the cards array: sort cards by id, canonical-stringify, sha256.
export async function cardsChecksum(cards: any[]): Promise<string> {
  const sorted = [...cards].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return sha256HexAsync(stableStringify(sorted));
}

// Embedded instruction manual (markdown) baked into every backup file.
export const BACKUP_MANUAL_MD = `# ${APP_NAME} — Backup File

This JSON file is a full export of your board's cards and metadata.

## Fields
- **app_name / version / timestamp** — provenance of this backup.
- **card_count / media_count** — quick integrity counts.
- **checksum** — sha256 over the cards array (sorted by id, canonical JSON).
- **cards** — every card with all fields (draft, checklist, media, resources,
  custom_fields, notes, content_pillar, platform_ready, platforms, etc.).

## Restoring
1. Open the app → Admin → Data tab (or the board toolbar Backup control).
2. Choose "Restore" and upload this file.
3. The checksum is verified; a mismatch or schema-version difference warns you.
4. Confirm to replace the current board state.

The old flat format (a bare JSON array of cards at the top level) is also
accepted on restore.
`;
