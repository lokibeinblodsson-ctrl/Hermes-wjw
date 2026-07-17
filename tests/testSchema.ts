// Shared in-memory D1 schema for the vitest-pool-workers test suite. Inlined as
// a string because the bundler does not support node:fs / ?raw imports inside
// the test module graph. Source of truth remains migrations/; keep in sync.
// Extracted from tests/app.test.ts so multiple suites share one schema.
export const TEST_SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT 'member',
  status TEXT NOT NULL DEFAULT 'invited', email_verified INTEGER NOT NULL DEFAULT 0,
  force_reset INTEGER NOT NULL DEFAULT 0, token_version INTEGER NOT NULL DEFAULT 0,
  invite_token TEXT, invited_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  last_login_at TEXT, failed_logins INTEGER NOT NULL DEFAULT 0, locked_until TEXT
);
CREATE TABLE IF NOT EXISTS email_verifications (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL, expires_at TEXT NOT NULL,
  used_at TEXT, created_at TEXT NOT NULL, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS password_resets (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash TEXT NOT NULL, expires_at TEXT NOT NULL,
  used_at TEXT, created_at TEXT NOT NULL, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT '#7c9c64',
  position INTEGER NOT NULL DEFAULT 0, created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS board_columns (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, color TEXT NOT NULL DEFAULT '#444',
  wip_limit INTEGER, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY, column_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'medium', due_date TEXT, category_id TEXT, tags_json TEXT NOT NULL DEFAULT '[]',
  assignee_id TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0, draft TEXT, checklist TEXT NOT NULL DEFAULT '[]', media TEXT NOT NULL DEFAULT '[]',
  resources TEXT NOT NULL DEFAULT '[]', custom_fields TEXT NOT NULL DEFAULT '[]', notes TEXT, content_pillar TEXT,
  platform_ready INTEGER NOT NULL DEFAULT 0, platforms TEXT NOT NULL DEFAULT '[]', research_page_id TEXT, scheduled_date TEXT,
  FOREIGN KEY (column_id) REFERENCES board_columns(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
  FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', assignee_id TEXT, creator_id TEXT,
  due_date TEXT, status TEXT NOT NULL DEFAULT 'open', priority TEXT NOT NULL DEFAULT 'medium',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL, FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS task_history (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL, actor_id TEXT, action TEXT NOT NULL, from_state TEXT, to_state TEXT,
  note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '', is_private INTEGER NOT NULL DEFAULT 0,
  allowed_roles_json TEXT NOT NULL DEFAULT '[]', position INTEGER NOT NULL DEFAULT 0, created_by TEXT, created_at TEXT NOT NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, title TEXT NOT NULL, author_id TEXT, pinned INTEGER NOT NULL DEFAULT 0,
  locked INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE, FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, parent_id TEXT, author_id TEXT, body TEXT NOT NULL,
  mentions_json TEXT NOT NULL DEFAULT '[]', edited_at TEXT, deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE, FOREIGN KEY (parent_id) REFERENCES messages(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cards_column ON cards(column_id, position);
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY, actor_id TEXT, action TEXT NOT NULL, target_type TEXT, target_id TEXT,
  meta_json TEXT NOT NULL DEFAULT '{}', ip TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id, created_at);
CREATE TABLE IF NOT EXISTS analytics_events (
  id TEXT PRIMARY KEY, event_type TEXT NOT NULL, user_id TEXT, meta_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analytics_type ON analytics_events(event_type, created_at);
CREATE TABLE IF NOT EXISTS feature_flags (
  name TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, description TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL, updated_by TEXT
);
CREATE TABLE IF NOT EXISTS settings ( key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT );
CREATE TABLE IF NOT EXISTS email_outbox (
  id TEXT PRIMARY KEY, to_addr TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, sent_at TEXT
);
CREATE TABLE IF NOT EXISTS memory_notes (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]', source TEXT NOT NULL DEFAULT '', embedding_json TEXT NOT NULL DEFAULT '[]',
  created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5( title, body, summary, tags, content='memory_notes', content_rowid='rowid' );
CREATE INDEX IF NOT EXISTS idx_memory_type ON memory_notes(type, created_at);
CREATE TRIGGER IF NOT EXISTS memory_ai AFTER INSERT ON memory_notes BEGIN
  INSERT INTO memory_fts(rowid, title, body, summary, tags) VALUES ((SELECT rowid FROM memory_notes WHERE id = NEW.id), NEW.title, NEW.body, NEW.summary, NEW.tags_json);
END;
CREATE TRIGGER IF NOT EXISTS memory_ad AFTER DELETE ON memory_notes BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, title, body, summary, tags) VALUES ('delete', OLD.rowid, OLD.title, OLD.body, OLD.summary, OLD.tags_json);
END;
CREATE TRIGGER IF NOT EXISTS memory_au AFTER UPDATE ON memory_notes BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, title, body, summary, tags) VALUES ('delete', OLD.rowid, OLD.title, OLD.body, OLD.summary, OLD.tags_json);
  INSERT INTO memory_fts(rowid, title, body, summary, tags) VALUES ((SELECT rowid FROM memory_notes WHERE id = NEW.id), NEW.title, NEW.body, NEW.summary, NEW.tags_json);
END;
CREATE TABLE IF NOT EXISTS content_items (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', image_prompt TEXT NOT NULL DEFAULT '',
  image_url TEXT, status TEXT NOT NULL DEFAULT 'draft', reviewer_id TEXT, reviewer_note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL, FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS publish_events (
  id TEXT PRIMARY KEY, content_id TEXT NOT NULL, actor_id TEXT, action TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, FOREIGN KEY (content_id) REFERENCES content_items(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS hermes_conversations (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL DEFAULT 'New conversation',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS hermes_messages (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL, body TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES hermes_conversations(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS calendar_items (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'scheduled', platform TEXT,
  card_id TEXT, content_id TEXT, note TEXT NOT NULL DEFAULT '', created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE SET NULL, FOREIGN KEY (content_id) REFERENCES content_items(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY, owner_id TEXT, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'file', mime TEXT, url TEXT,
  size_bytes INTEGER, tags_json TEXT NOT NULL DEFAULT '[]', note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS card_comments (
  id TEXT PRIMARY KEY, card_id TEXT NOT NULL, parent_id TEXT, author_id TEXT, author_name TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL, deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE, FOREIGN KEY (parent_id) REFERENCES card_comments(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_card_comments_card ON card_comments(card_id, created_at);
CREATE TABLE IF NOT EXISTS card_sources (
  id TEXT PRIMARY KEY, card_id TEXT NOT NULL, source_type TEXT NOT NULL DEFAULT 'website', authors TEXT NOT NULL DEFAULT '',
  year TEXT, title TEXT NOT NULL DEFAULT '', publisher TEXT NOT NULL DEFAULT '', url TEXT, retrieved_date TEXT,
  citation TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE, FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_card_sources_card ON card_sources(card_id, created_at);
CREATE TABLE IF NOT EXISTS card_links (
  id TEXT PRIMARY KEY, card_id TEXT NOT NULL, link_type TEXT NOT NULL DEFAULT 'related_card', target_card_id TEXT,
  target_title TEXT NOT NULL DEFAULT '', target_url TEXT, note TEXT NOT NULL DEFAULT '', created_by TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE, FOREIGN KEY (target_card_id) REFERENCES cards(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_card_links_card ON card_links(card_id, link_type);
`;

// Split a SQL script into statements, keeping BEGIN...END trigger bodies intact.
export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = "";
  let inTrigger = false;
  for (const line of sql.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("--")) continue;
    if (/^PRAGMA/i.test(trimmed)) continue;
    if (/\bBEGIN\b/i.test(trimmed)) inTrigger = true;
    buf += line + "\n";
    if (/\bEND\s*;?$/i.test(trimmed)) {
      if (buf.trim().endsWith(";") || /\bEND\b/i.test(buf)) { out.push(buf.trim().replace(/;$/, "")); buf = ""; inTrigger = false; }
      continue;
    }
    if (!inTrigger && trimmed.endsWith(";")) { out.push(buf.trim().replace(/;$/, "")); buf = ""; }
  }
  if (buf.trim()) out.push(buf.trim().replace(/;$/, ""));
  return out;
}
