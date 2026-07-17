-- Wild Jazmine Wellness — D1 schema (SQLite).
-- One migration file keeps deploy ordering deterministic.

PRAGMA foreign_keys = ON;

-- ───────────────────────── Users & auth ─────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                TEXT PRIMARY KEY,
  email             TEXT NOT NULL UNIQUE,
  display_name      TEXT NOT NULL DEFAULT '',
  password_hash     TEXT NOT NULL DEFAULT '',
  role              TEXT NOT NULL DEFAULT 'member',   -- admin | moderator | reviewer | member
  status            TEXT NOT NULL DEFAULT 'invited',  -- active | disabled | invited | suspended
  email_verified    INTEGER NOT NULL DEFAULT 0,
  force_reset       INTEGER NOT NULL DEFAULT 0,       -- force password change on next login
  token_version     INTEGER NOT NULL DEFAULT 0,       -- bump to invalidate all sessions
  invite_token      TEXT,                             -- for invite-only signup
  invited_by        TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  last_login_at     TEXT,
  failed_logins     INTEGER NOT NULL DEFAULT 0,
  locked_until      TEXT
);

CREATE TABLE IF NOT EXISTS email_verifications (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  token_hash  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS password_resets (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  token_hash  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ───────────────────────── Categories ─────────────────────────
CREATE TABLE IF NOT EXISTS categories (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  color       TEXT NOT NULL DEFAULT '#7c9c64',
  position    INTEGER NOT NULL DEFAULT 0,
  created_by  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- ───────────────────────── Kanban board ─────────────────────────
CREATE TABLE IF NOT EXISTS board_columns (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL DEFAULT 0,
  color      TEXT NOT NULL DEFAULT '#444',
  wip_limit  INTEGER,                              -- NULL = no limit
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cards (
  id           TEXT PRIMARY KEY,
  column_id    TEXT NOT NULL,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  priority     TEXT NOT NULL DEFAULT 'medium',     -- low | medium | high | urgent
  due_date     TEXT,                               -- ISO date or NULL
  category_id  TEXT,
  tags_json    TEXT NOT NULL DEFAULT '[]',
  assignee_id  TEXT,
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  position     INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (column_id)   REFERENCES board_columns(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
  FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by)  REFERENCES users(id) ON DELETE SET NULL
);

-- ───────────────────────── Tasks (admin-assigned) ─────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  assignee_id  TEXT,
  creator_id   TEXT,
  due_date     TEXT,
  status       TEXT NOT NULL DEFAULT 'open',        -- open | in_progress | blocked | done | cancelled
  priority     TEXT NOT NULL DEFAULT 'medium',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (creator_id)  REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS task_history (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL,
  actor_id   TEXT,
  action     TEXT NOT NULL,        -- created | assigned | reassigned | status_changed | priority_changed | closed | reopened | edited
  from_state TEXT,
  to_state   TEXT,
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

-- ───────────────────────── Chat ─────────────────────────
CREATE TABLE IF NOT EXISTS channels (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL UNIQUE,
  description        TEXT NOT NULL DEFAULT '',
  is_private         INTEGER NOT NULL DEFAULT 0,
  allowed_roles_json TEXT NOT NULL DEFAULT '[]',
  position           INTEGER NOT NULL DEFAULT 0,
  created_by         TEXT,
  created_at         TEXT NOT NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS threads (
  id          TEXT PRIMARY KEY,
  channel_id  TEXT NOT NULL,
  title       TEXT NOT NULL,
  author_id   TEXT,
  pinned      INTEGER NOT NULL DEFAULT 0,
  locked      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id)   REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,
  thread_id   TEXT NOT NULL,
  parent_id   TEXT,                                -- for nested replies within a thread
  author_id   TEXT,
  body        TEXT NOT NULL,
  mentions_json TEXT NOT NULL DEFAULT '[]',
  edited_at   TEXT,
  deleted_at  TEXT,                                -- soft delete
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES messages(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cards_column ON cards(column_id, position);

-- ───────────────────────── Audit, analytics, settings ─────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT,
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  meta_json   TEXT NOT NULL DEFAULT '{}',
  ip          TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id, created_at);

CREATE TABLE IF NOT EXISTS analytics_events (
  id          TEXT PRIMARY KEY,
  event_type  TEXT NOT NULL,
  user_id     TEXT,
  meta_json   TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analytics_type ON analytics_events(event_type, created_at);

CREATE TABLE IF NOT EXISTS feature_flags (
  name        TEXT PRIMARY KEY,
  enabled     INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL,
  updated_by  TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value_json  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  updated_by  TEXT
);

CREATE TABLE IF NOT EXISTS email_outbox (
  id          TEXT PRIMARY KEY,
  to_addr     TEXT NOT NULL,
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  sent_at     TEXT
);

-- ───────────────────────── RAG / semantic memory ─────────────────────────
CREATE TABLE IF NOT EXISTS memory_notes (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,      -- fact | idea | plan | decision | changelog | bug | request | note
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  summary     TEXT NOT NULL DEFAULT '',
  tags_json   TEXT NOT NULL DEFAULT '[]',
  source      TEXT NOT NULL DEFAULT '',
  embedding_json TEXT NOT NULL DEFAULT '[]',  -- fixed-dim vector (lexical-semantic)
  created_by  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- FTS5 text index kept in sync via triggers (keyword fallback + boost).
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  title, body, summary, tags,
  content='memory_notes', content_rowid='rowid'
);

CREATE INDEX IF NOT EXISTS idx_memory_type ON memory_notes(type, created_at);

-- Trigger sync for memory_fts
CREATE TRIGGER IF NOT EXISTS memory_ai AFTER INSERT ON memory_notes BEGIN
  INSERT INTO memory_fts(rowid, title, body, summary, tags)
  VALUES (
    (SELECT rowid FROM memory_notes WHERE id = NEW.id),
    NEW.title, NEW.body, NEW.summary, NEW.tags_json
  );
END;
CREATE TRIGGER IF NOT EXISTS memory_ad AFTER DELETE ON memory_notes BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, title, body, summary, tags)
  VALUES ('delete', OLD.rowid, OLD.title, OLD.body, OLD.summary, OLD.tags_json);
END;
CREATE TRIGGER IF NOT EXISTS memory_au AFTER UPDATE ON memory_notes BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, title, body, summary, tags)
  VALUES ('delete', OLD.rowid, OLD.title, OLD.body, OLD.summary, OLD.tags_json);
  INSERT INTO memory_fts(rowid, title, body, summary, tags)
  VALUES (
    (SELECT rowid FROM memory_notes WHERE id = NEW.id),
    NEW.title, NEW.body, NEW.summary, NEW.tags_json
  );
END;

-- ───────────────────────── Content + publishing pipeline ─────────────────────────
-- Content drafts that flow through a publish/review lifecycle. A reviewer can
-- approve/reject; an approved item enters the publish queue and (when published)
-- gets an image generated + stored and a public URL recorded for social posting.
CREATE TABLE IF NOT EXISTS content_items (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  body          TEXT NOT NULL DEFAULT '',
  image_prompt  TEXT NOT NULL DEFAULT '',      -- prompt used for generated hero image
  image_url     TEXT,                           -- public URL of stored generated image
  status        TEXT NOT NULL DEFAULT 'draft', -- draft | in_review | approved | published | rejected
  reviewer_id   TEXT,
  reviewer_note TEXT NOT NULL DEFAULT '',
  created_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_content_status ON content_items(status, updated_at);

CREATE TABLE IF NOT EXISTS publish_events (
  id          TEXT PRIMARY KEY,
  content_id  TEXT NOT NULL,
  actor_id    TEXT,
  action      TEXT NOT NULL,   -- submitted | approved | rejected | published
  note        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  FOREIGN KEY (content_id) REFERENCES content_items(id) ON DELETE CASCADE
);
