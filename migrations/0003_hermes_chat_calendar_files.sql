-- Wild Jazmine Wellness — migration 0003: Hermes AI chat, content calendar, files.
-- All new tables are additive (no ALTER of existing core tables except a
-- non-destructive ADD on cards). Existing rows backfill automatically.

-- ───────────────────────── Hermes AI chat ─────────────────────────
-- Lightweight assistant conversations + messages, scoped per user. Messages
-- are persisted so the sidebar can show history; the LLM call itself is
-- wired externally (scaffolded) and may fall back to a rule-based responder.
CREATE TABLE IF NOT EXISTS hermes_conversations (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT 'New conversation',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_hermes_conv_user ON hermes_conversations(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS hermes_messages (
  id               TEXT PRIMARY KEY,
  conversation_id  TEXT NOT NULL,
  role             TEXT NOT NULL,        -- user | assistant
  body             TEXT NOT NULL,
  context_json     TEXT NOT NULL DEFAULT '{}',  -- board snapshot / refs attached
  created_at       TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES hermes_conversations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_hermes_msg_conv ON hermes_messages(conversation_id, created_at ASC);

-- ───────────────────────── Content calendar ─────────────────────────
-- Card-level scheduled date (when this card's content should publish).
ALTER TABLE cards ADD COLUMN scheduled_date TEXT;   -- ISO date (YYYY-MM-DD) or NULL
CREATE INDEX IF NOT EXISTS idx_cards_scheduled ON cards(scheduled_date);

-- Calendar entries are primarily derived from card.scheduled_date. This table
-- supports richer scheduled items (e.g. content_items, external posts) if
-- needed later. For now it ties a dated plan to a board card + optional status.
CREATE TABLE IF NOT EXISTS calendar_items (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  date        TEXT NOT NULL,                 -- YYYY-MM-DD
  status      TEXT NOT NULL DEFAULT 'scheduled',  -- scheduled | draft | in_review | approved | published | done
  platform    TEXT,
  card_id     TEXT,                          -- link to a board card (nullable)
  content_id  TEXT,                          -- link to a publishing content item (nullable)
  note        TEXT NOT NULL DEFAULT '',
  created_by  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE SET NULL,
  FOREIGN KEY (content_id) REFERENCES content_items(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_cal_date ON calendar_items(date);

-- ───────────────────────── Files ─────────────────────────
-- Metadata for uploaded files (PDFs, images, references, assets). Binary bytes
-- live in R2/B2 via the storage adapter; here we keep the pointer + metadata so
-- the UI can list, preview, search, and tag without re-fetching blobs.
CREATE TABLE IF NOT EXISTS files (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'file',   -- file | image | pdf | doc | link | asset
  mime        TEXT,
  url         TEXT,                            -- public URL (R2/B2) or data: URL (inline fallback)
  size_bytes  INTEGER,
  tags_json   TEXT NOT NULL DEFAULT '[]',
  note        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_files_kind ON files(kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_tags ON files(tags_json);
