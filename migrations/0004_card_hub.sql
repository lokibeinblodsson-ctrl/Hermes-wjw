-- Wild Jazmine Wellness — migration 0004: card hub / record view.
-- Adds threaded comments, scholarly/website source records (with APA fields),
-- and explicit card relationships (related cards + related posts/pages) to turn
-- each card into an operational record.
--
-- All new columns/tables are additive and safe to apply to a populated DB.

-- ── Threaded comments on a card ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS card_comments (
  id         TEXT PRIMARY KEY,
  card_id    TEXT NOT NULL,
  parent_id  TEXT,                              -- for threaded replies (null = top-level)
  author_id  TEXT,
  author_name TEXT NOT NULL DEFAULT '',         -- denormalized for display
  body       TEXT NOT NULL,
  deleted_at TEXT,                              -- soft delete (hide, keep for audit)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (card_id)   REFERENCES cards(id)   ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES card_comments(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id)   ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_card_comments_card ON card_comments(card_id, created_at);
CREATE INDEX IF NOT EXISTS idx_card_comments_parent ON card_comments(parent_id);

-- ── Sources / citations (APA-oriented) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS card_sources (
  id         TEXT PRIMARY KEY,
  card_id    TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'website',  -- website | article | book | scholarly | reference
  authors    TEXT NOT NULL DEFAULT '',          -- "Smith, J., & Doe, A." (APA author string)
  year       TEXT,                              -- publication year (APA)
  title      TEXT NOT NULL DEFAULT '',          -- work title
  publisher  TEXT NOT NULL DEFAULT '',          -- publisher / outlet / site name
  url        TEXT,                              -- source link
  retrieved_date TEXT,                          -- for websites: "(n.d.). Retrieved ... from"
  citation   TEXT NOT NULL DEFAULT '',          -- full APA citation (auto-built or hand-edited)
  note       TEXT NOT NULL DEFAULT '',          -- why this source matters
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (card_id)    REFERENCES cards(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_card_sources_card ON card_sources(card_id, created_at);

-- ── Relationships / related content ───────────────────────────────────────
-- Tracks related cards and related website posts/pages for traceability.
-- link_type: related_card | related_post
CREATE TABLE IF NOT EXISTS card_links (
  id          TEXT PRIMARY KEY,
  card_id     TEXT NOT NULL,                     -- the card this link belongs to
  link_type   TEXT NOT NULL DEFAULT 'related_card',
  target_card_id TEXT,                           -- set when link_type = related_card
  target_title   TEXT NOT NULL DEFAULT '',       -- for related_post: the post/page title
  target_url      TEXT,                          -- for related_post: the live URL
  note        TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (card_id)       REFERENCES cards(id) ON DELETE CASCADE,
  FOREIGN KEY (target_card_id) REFERENCES cards(id) ON DELETE CASCADE,
  UNIQUE (card_id, link_type, target_card_id)
);
CREATE INDEX IF NOT EXISTS idx_card_links_card ON card_links(card_id, link_type);
