-- Migration 0006: AI-powered Kanban research, tag taxonomy, and card-link knowledge graph.
--
-- Single tenant, same as the rest of WJW (no workspace_id — the app is one
-- workspace per deployment). All tables add tenant-consistent columns
-- (created_by, timestamps) and follow WJW's JSON-column convention.
--
-- Research run lifecycle:
--   queued -> running -> completed | needs_review | failed | cancelled | stale
-- Each run stores an idempotency content_hash so we never re-run on the same
-- meaningful revision unless explicitly re-run.

-- ───────── AI research runs (one per research attempt on a card) ─────────
CREATE TABLE IF NOT EXISTS card_ai_runs (
  id            TEXT PRIMARY KEY,
  card_id       TEXT NOT NULL,
  trigger       TEXT NOT NULL,            -- created | moved | manual | rerun
  status        TEXT NOT NULL DEFAULT 'queued',
  content_hash  TEXT,                     -- hash of meaningful card fields
  intake_json   TEXT NOT NULL DEFAULT '{}',
  config_json   TEXT NOT NULL DEFAULT '{}',
  error         TEXT,
  created_by    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  completed_at  TEXT,
  FOREIGN KEY (card_id)   REFERENCES cards(id)   ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id)  ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_card     ON card_ai_runs(card_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_status   ON card_ai_runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_hash     ON card_ai_runs(card_id, content_hash);

-- ───────── Structured research brief (the AI output) ─────────
CREATE TABLE IF NOT EXISTS card_research_notes (
  id           TEXT PRIMARY KEY,
  card_id      TEXT NOT NULL,
  run_id       TEXT NOT NULL,
  version      INTEGER NOT NULL DEFAULT 1,
  status       TEXT NOT NULL DEFAULT 'draft',   -- draft | active | rejected
  content_json TEXT NOT NULL DEFAULT '{}',      -- full brief (summary, insights, sources refs, etc.)
  sources_json TEXT NOT NULL DEFAULT '[]',
  applied_tags_json TEXT NOT NULL DEFAULT '[]',
  proposed_tags_json TEXT NOT NULL DEFAULT '[]',
  proposed_links_json TEXT NOT NULL DEFAULT '[]',
  created_by   TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id)  REFERENCES card_ai_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_card    ON card_research_notes(card_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_notes_run     ON card_research_notes(run_id);

-- ───────── Research sources (cited, stored separately from card text) ─────────
CREATE TABLE IF NOT EXISTS research_sources (
  id           TEXT PRIMARY KEY,
  note_id      TEXT NOT NULL,
  title        TEXT NOT NULL DEFAULT '',
  url          TEXT,
  publisher    TEXT,
  published_date TEXT,
  relevance    TEXT,
  retrieved_at TEXT,
  FOREIGN KEY (note_id) REFERENCES card_research_notes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sources_note ON research_sources(note_id);

-- ───────── Tag taxonomy (workspace-scoped) ─────────
CREATE TABLE IF NOT EXISTS tags (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,     -- canonical, normalized
  usage_count  INTEGER NOT NULL DEFAULT 0,
  created_by   TEXT,
  source       TEXT NOT NULL DEFAULT 'system',  -- user | ai | imported | system
  created_at   TEXT NOT NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Alias -> canonical tag (e.g. "auth", "login" -> "authentication").
CREATE TABLE IF NOT EXISTS tag_aliases (
  id           TEXT PRIMARY KEY,
  alias        TEXT NOT NULL UNIQUE,
  canonical_tag_id TEXT NOT NULL,
  created_by   TEXT,
  FOREIGN KEY (canonical_tag_id) REFERENCES tags(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_alias ON tag_aliases(alias);

-- Card <-> tag (with source + confidence). Replaces the free-form tags_json
-- cardinality with first-class, auditable membership while keeping the card's
-- tags_json as a denormalized convenience copy.
CREATE TABLE IF NOT EXISTS card_tags (
  id           TEXT PRIMARY KEY,
  card_id      TEXT NOT NULL,
  tag_id       TEXT NOT NULL,
  source       TEXT NOT NULL DEFAULT 'user',   -- user | ai | imported | system
  confidence   REAL NOT NULL DEFAULT 1.0,
  status       TEXT NOT NULL DEFAULT 'active', -- active | proposed | rejected
  created_by   TEXT,
  created_at   TEXT NOT NULL,
  FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id)  REFERENCES tags(id)   ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (card_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_cardtags_card ON card_tags(card_id, status);
CREATE INDEX IF NOT EXISTS idx_cardtags_tag  ON card_tags(tag_id);

-- ───────── Card relationships / knowledge graph ─────────
CREATE TABLE IF NOT EXISTS card_ai_links (
  id           TEXT PRIMARY KEY,
  source_card_id TEXT NOT NULL,
  target_card_id TEXT NOT NULL,
  relationship_type TEXT NOT NULL,  -- related_to | duplicate_of | follow_up_to | implementation_of | background_for | blocks | blocked_by | depends_on | contradicts
  confidence   REAL NOT NULL DEFAULT 0.5,
  explanation  TEXT NOT NULL DEFAULT '',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  source       TEXT NOT NULL DEFAULT 'ai',       -- user | ai | system
  status       TEXT NOT NULL DEFAULT 'proposed',  -- proposed | approved | active | rejected
  created_by   TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  FOREIGN KEY (source_card_id) REFERENCES cards(id) ON DELETE CASCADE,
  FOREIGN KEY (target_card_id) REFERENCES cards(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (source_card_id, target_card_id, relationship_type)
);
CREATE INDEX IF NOT EXISTS idx_ailinks_src ON card_ai_links(source_card_id, status);
CREATE INDEX IF NOT EXISTS idx_ailinks_tgt ON card_ai_links(target_card_id, status);

-- ───────── Per-card AI research configuration (board/workspace defaults via settings) ─────────
CREATE TABLE IF NOT EXISTS ai_research_config (
  id                  TEXT PRIMARY KEY,
  scope               TEXT NOT NULL DEFAULT 'workspace',  -- workspace | board
  scope_id            TEXT,                                 -- board_columns.id when scope=board
  enabled             INTEGER NOT NULL DEFAULT 0,
  intake_column_id    TEXT,                                 -- column that triggers research
  post_research_column_id TEXT,                             -- optional auto-move target
  allow_external_research INTEGER NOT NULL DEFAULT 0,
  config_json         TEXT NOT NULL DEFAULT '{}',           -- thresholds, tag limits, review mode
  updated_by          TEXT,
  updated_at          TEXT NOT NULL,
  created_at          TEXT NOT NULL,
  FOREIGN KEY (intake_column_id) REFERENCES board_columns(id) ON DELETE SET NULL,
  FOREIGN KEY (post_research_column_id) REFERENCES board_columns(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (scope, scope_id)
);
