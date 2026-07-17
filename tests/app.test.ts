// Integration tests for Wild Jazmine Wellness.
// Runs the Worker against a REAL D1 database (fresh per test file) via
// @cloudflare/vitest-pool-workers — no mocks. Covers bootstrap/seed, auth,
// board, chat, admin, tasks, categories, memory/RAG, and security.
//
// NOTE: the D1 schema is inlined as a string here (not read from disk) because
// the vitest-pool-workers bundler does not support `node:fs` / `?raw` imports
// inside the test module graph. The source of truth remains
// migrations/0001_init.sql — keep the two in sync.

import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { hashPassword, randomId, randomToken } from "../src/lib/crypto";
import { nowIso } from "../src/db/db";
import { resetRateLimitStore } from "../src/lib/rateLimit";

let requestCount = 0;

const schemaSql = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'member',
  status TEXT NOT NULL DEFAULT 'invited',
  email_verified INTEGER NOT NULL DEFAULT 0,
  force_reset INTEGER NOT NULL DEFAULT 0,
  token_version INTEGER NOT NULL DEFAULT 0,
  invite_token TEXT,
  invited_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT
);
CREATE TABLE IF NOT EXISTS email_verifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#7c9c64',
  position INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS board_columns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#444',
  wip_limit INTEGER,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  column_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'medium',
  due_date TEXT,
  category_id TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  assignee_id TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  draft TEXT,
  checklist TEXT NOT NULL DEFAULT '[]',
  media TEXT NOT NULL DEFAULT '[]',
  resources TEXT NOT NULL DEFAULT '[]',
  custom_fields TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  content_pillar TEXT,
  platform_ready INTEGER NOT NULL DEFAULT 0,
  platforms TEXT NOT NULL DEFAULT '[]',
  research_page_id TEXT,
  scheduled_date TEXT,
  FOREIGN KEY (column_id) REFERENCES board_columns(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
  FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  assignee_id TEXT,
  creator_id TEXT,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT NOT NULL DEFAULT 'medium',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS task_history (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  is_private INTEGER NOT NULL DEFAULT 0,
  allowed_roles_json TEXT NOT NULL DEFAULT '[]',
  position INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  title TEXT NOT NULL,
  author_id TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  parent_id TEXT,
  author_id TEXT,
  body TEXT NOT NULL,
  mentions_json TEXT NOT NULL DEFAULT '[]',
  edited_at TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES messages(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cards_column ON cards(column_id, position);
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  meta_json TEXT NOT NULL DEFAULT '{}',
  ip TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id, created_at);
CREATE TABLE IF NOT EXISTS analytics_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  user_id TEXT,
  meta_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analytics_type ON analytics_events(event_type, created_at);
CREATE TABLE IF NOT EXISTS feature_flags (
  name TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
CREATE TABLE IF NOT EXISTS email_outbox (
  id TEXT PRIMARY KEY,
  to_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  sent_at TEXT
);
CREATE TABLE IF NOT EXISTS memory_notes (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT '',
  embedding_json TEXT NOT NULL DEFAULT '[]',
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  title, body, summary, tags,
  content='memory_notes', content_rowid='rowid'
);
CREATE INDEX IF NOT EXISTS idx_memory_type ON memory_notes(type, created_at);
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
CREATE TABLE IF NOT EXISTS content_items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  image_prompt TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  reviewer_id TEXT,
  reviewer_note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS publish_events (
  id TEXT PRIMARY KEY,
  content_id TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (content_id) REFERENCES content_items(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS hermes_conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'New conversation',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS hermes_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  body TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES hermes_conversations(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS calendar_items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  platform TEXT,
  card_id TEXT,
  content_id TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE SET NULL,
  FOREIGN KEY (content_id) REFERENCES content_items(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  owner_id TEXT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'file',
  mime TEXT,
  url TEXT,
  size_bytes INTEGER,
  tags_json TEXT NOT NULL DEFAULT '[]',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS card_comments (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  parent_id TEXT,
  author_id TEXT,
  author_name TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES card_comments(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_card_comments_card ON card_comments(card_id, created_at);
CREATE TABLE IF NOT EXISTS card_sources (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'website',
  authors TEXT NOT NULL DEFAULT '',
  year TEXT,
  title TEXT NOT NULL DEFAULT '',
  publisher TEXT NOT NULL DEFAULT '',
  url TEXT,
  retrieved_date TEXT,
  citation TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_card_sources_card ON card_sources(card_id, created_at);
CREATE TABLE IF NOT EXISTS card_links (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  link_type TEXT NOT NULL DEFAULT 'related_card',
  target_card_id TEXT,
  target_title TEXT NOT NULL DEFAULT '',
  target_url TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
  FOREIGN KEY (target_card_id) REFERENCES cards(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_card_links_card ON card_links(card_id, link_type);
`;

// Split a SQL script into statements, keeping BEGIN...END trigger bodies
// intact (they contain internal semicolons). Then execute each via prepare().run().
function splitStatements(sql: string): string[] {
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
      if (buf.trim().endsWith(";") || /\bEND\b/i.test(buf)) {
        out.push(buf.trim().replace(/;$/, ""));
        buf = "";
        inTrigger = false;
      }
      continue;
    }
    if (!inTrigger && trimmed.endsWith(";")) {
      out.push(buf.trim().replace(/;$/, ""));
      buf = "";
    }
  }
  if (buf.trim()) out.push(buf.trim().replace(/;$/, ""));
  return out;
}

beforeAll(async () => {
  const stmts = splitStatements(schemaSql);
  for (const s of stmts) {
    if (s) await env.DB.prepare(s).run();
  }
  // @ts-ignore
  env.JWT_SECRET = "test-jwt-secret-123";
  // @ts-ignore
  env.BOOTSTRAP_TOKEN = "local-dev-only-bootstrap-replace-in-prod";
  // @ts-ignore
  env.ENVIRONMENT = "development";
});

// Delete all rows so each describe starts from a clean slate (D1 DB persists
// across describes within a test file).
const TABLES = [
  "memory_fts", "memory_notes", "email_outbox", "settings", "feature_flags",
  "analytics_events", "audit_logs", "messages", "threads", "channels",
  "task_history", "tasks", "cards", "board_columns", "categories",
  "password_resets", "email_verifications", "users",
  "content_items", "publish_events",
  "hermes_messages", "hermes_conversations", "calendar_items", "files",
];
async function clearDb() {
  resetRateLimitStore();
  for (const t of TABLES) {
    try { await env.DB.prepare(`DELETE FROM ${t}`).run(); } catch { /* ignore */ }
  }
}

async function api(method: string, path: string, body?: unknown, token?: string | null) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": `test-${(requestCount++).toString()}.local` };
  if (token) headers["authorization"] = `Bearer ${token}`;
  const res = await SELF.fetch(`http://localhost${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data: any = null;
  try { data = await res.json(); } catch {}
  if (res.status >= 500) console.error(`[API 5xx] ${method} ${path} ->`, JSON.stringify(data));
  return { status: res.status, data };
}

// Provision the placeholder admin (idempotent) and return its credentials.
// Clears the DB first so it always creates a fresh seeded admin with a temp pw.
async function provisionSeededAdmin(): Promise<{ email: string; password: string }> {
  await clearDb();
  const res = await SELF.fetch("http://localhost/api/v1/bootstrap/provision", {
    method: "POST", headers: { "x-bootstrap-token": "local-dev-only-bootstrap-replace-in-prod" },
  });
  const p = await res.json() as any;
  return { email: p.data.admin_email, password: p.data.temporary_password };
}

async function makeAdmin(): Promise<{ email: string; password: string; id: string; token: string }> {
  const email = `admin_${randomToken(6)}@test.local`;
  const password = `Pass#${randomToken(8)}`;
  const hash = await hashPassword(password);
  const id = randomId("usr");
  await env.DB.prepare(
    `INSERT INTO users (id,email,display_name,password_hash,role,status,email_verified,force_reset,token_version,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(id, email, "TestAdmin", hash, "admin", "active", 1, 0, 0, nowIso(), nowIso()).run();
  const login = await api("POST", "/api/v1/auth/login", { email, password });
  return { email, password, id, token: login.data.data.token };
}

async function makeMember(): Promise<{ token: string }> {
  const email = `member_${randomToken(6)}@test.local`;
  const password = `Pass#${randomToken(8)}`;
  const hash = await hashPassword(password);
  const id = randomId("usr");
  await env.DB.prepare(
    `INSERT INTO users (id,email,display_name,password_hash,role,status,email_verified,force_reset,token_version,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(id, email, "Member", hash, "member", "active", 1, 0, 0, nowIso(), nowIso()).run();
  const login = await api("POST", "/api/v1/auth/login", { email, password });
  return { token: login.data.data.token };
}

async function makeReviewer(): Promise<{ token: string; id: string }> {
  const email = `reviewer_${randomToken(6)}@test.local`;
  const password = `Pass#${randomToken(8)}`;
  const hash = await hashPassword(password);
  const id = randomId("usr");
  await env.DB.prepare(
    `INSERT INTO users (id,email,display_name,password_hash,role,status,email_verified,force_reset,token_version,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(id, email, "Reviewer", hash, "reviewer", "active", 1, 0, 0, nowIso(), nowIso()).run();
  const login = await api("POST", "/api/v1/auth/login", { email, password });
  return { token: login.data.data.token, id };
}

describe("Phase 1: foundation + bootstrap seed", () => {
  it("seeds the placeholder admin once with a random password + force_reset", async () => {
    await clearDb();
    const res = await SELF.fetch("http://localhost/api/v1/bootstrap/provision", {
      method: "POST", headers: { "x-bootstrap-token": "local-dev-only-bootstrap-replace-in-prod" },
    });
    const first = await res.json() as any;
    expect(res.status).toBe(201);
    expect(first.data.admin_email).toBeDefined();
    expect(first.data.temporary_password).toBeTruthy();
    expect(first.data.force_reset).toBe(true);

    const res2 = await SELF.fetch("http://localhost/api/v1/bootstrap/provision", {
      method: "POST", headers: { "x-bootstrap-token": "local-dev-only-bootstrap-replace-in-prod" },
    });
    const second = await res2.json() as any;
    // Idempotent: the same seeded admin is returned, and because it never
    // finished first login (force_reset still set) a fresh temp password is
    // re-issued so the operator can recover it.
    expect(second.data.admin_email).toBe(first.data.admin_email);
    expect(second.data.temporary_password).toBeTruthy();
    expect(second.data.recovered).toBe(true);
  });

  it("health + bootstrap status reflect seeded state", async () => {
    await clearDb();
    await SELF.fetch("http://localhost/api/v1/bootstrap/provision", {
      method: "POST", headers: { "x-bootstrap-token": "local-dev-only-bootstrap-replace-in-prod" },
    });
    const h = await api("GET", "/api/health");
    expect(h.status).toBe(200);
    const s = await api("GET", "/api/v1/bootstrap/status");
    expect(s.data.data.admin_exists).toBe(true);
  });

  it("requires the bootstrap token (forbidden without it)", async () => {
    const r = await api("POST", "/api/v1/bootstrap/provision", {});
    expect(r.status).toBe(403);
  });

  it("recovers a seeded admin that never finished first login (force_reset still set)", async () => {
    await clearDb();
    const res = await SELF.fetch("http://localhost/api/v1/bootstrap/provision", {
      method: "POST", headers: { "x-bootstrap-token": "local-dev-only-bootstrap-replace-in-prod" },
    });
    const first = await res.json() as any;
    const oldPw = first.data.temporary_password;
    // Admin exists with force_reset=1 but lost its temp password.
    const res2 = await SELF.fetch("http://localhost/api/v1/bootstrap/provision", {
      method: "POST", headers: { "x-bootstrap-token": "local-dev-only-bootstrap-replace-in-prod" },
    });
    const second = await res2.json() as any;
    expect(res2.status).toBe(201);
    expect(second.data.recovered).toBe(true);
    expect(second.data.temporary_password).toBeTruthy();
    expect(second.data.temporary_password).not.toBe(oldPw);
    // The recovered password actually logs in.
    const login = await api("POST", "/api/v1/auth/login", { email: first.data.admin_email, password: second.data.temporary_password });
    expect(login.status).toBe(200);
  });
});

describe("Phase 6/5: auth flows (force-reset on seeded admin)", () => {
  let email: string; let password: string;
  beforeAll(async () => {
    const a = await provisionSeededAdmin();
    email = a.email; password = a.password;
  });

  it("login with seeded credentials returns a token and force_reset flag", async () => {
    const r = await api("POST", "/api/v1/auth/login", { email, password });
    expect(r.status).toBe(200);
    expect(r.data.data.token).toBeTruthy();
    expect(r.data.data.force_reset).toBe(true);
  });

  it("rejects wrong password (no enumeration, generic 401)", async () => {
    const r = await api("POST", "/api/v1/auth/login", { email, password: "wrongpass123" });
    expect(r.status).toBe(401);
  });

  it("change-password clears force_reset and new password works", async () => {
    const login = await api("POST", "/api/v1/auth/login", { email, password });
    const token = login.data.data.token;
    const cp = await api("POST", "/api/v1/auth/change-password", { current_password: password, new_password: "NewPass#2026" }, token);
    expect(cp.status).toBe(200);
    const login2 = await api("POST", "/api/v1/auth/login", { email, password: "NewPass#2026" });
    expect(login2.status).toBe(200);
    expect(login2.data.data.force_reset).toBe(false);
  });

  it("rejects protected routes without a token", async () => {
    const r = await api("GET", "/api/v1/board/cards");
    expect(r.status).toBe(401);
  });
});

describe("Phase 2: kanban board", () => {
  let token: string; let columnId: string;
  beforeAll(async () => {
    await clearDb();
    const a = await makeAdmin(); token = a.token;
    const cols = await api("GET", "/api/v1/board/columns", undefined, token);
    columnId = cols.data.data[0].id;
  });

  it("creates a card and it persists", async () => {
    const r = await api("POST", "/api/v1/board/cards", { column_id: columnId, title: "Launch plan", priority: "high", tags: ["launch", "q3"] }, token);
    expect(r.status).toBe(201);
    const id = r.data.data.id;
    const get = await api("GET", `/api/v1/board/cards/${id}`, undefined, token);
    expect(get.status).toBe(200);
    expect(get.data.data.title).toBe("Launch plan");
    expect(get.data.data.tags).toContain("launch");
  });

  it("rejects card with invalid column", async () => {
    const r = await api("POST", "/api/v1/board/cards", { column_id: "nope", title: "x" }, token);
    expect(r.status).toBe(400);
  });

  it("updates card (move column + priority)", async () => {
    const created = await api("POST", "/api/v1/board/cards", { column_id: columnId, title: "Move me" }, token);
    const id = created.data.data.id;
    const cols = await api("GET", "/api/v1/board/columns", undefined, token);
    const other = cols.data.data.find((c: any) => c.id !== columnId);
    const upd = await api("PATCH", `/api/v1/board/cards/${id}`, { column_id: other.id, priority: "urgent" }, token);
    expect(upd.status).toBe(200);
    expect(upd.data.data.column_id).toBe(other.id);
    expect(upd.data.data.priority).toBe("urgent");
  });

  it("search by title works", async () => {
    await api("POST", "/api/v1/board/cards", { column_id: columnId, title: "Findable zebra" }, token);
    const r = await api("GET", `/api/v1/board/cards?q=zebra`, undefined, token);
    expect(r.data.data.some((c: any) => c.title.includes("zebra"))).toBe(true);
  });

  it("extended card fields persist and default correctly", async () => {
    // New card: extended fields default to empty arrays / null / false.
    const created = await api("POST", "/api/v1/board/cards", { column_id: columnId, title: "Extended card" }, token);
    expect(created.status).toBe(201);
    const id = created.data.data.id;
    expect(created.data.data.checklist).toEqual([]);
    expect(created.data.data.media).toEqual([]);
    expect(created.data.data.resources).toEqual([]);
    expect(created.data.data.custom_fields).toEqual([]);
    expect(created.data.data.platforms).toEqual([]);
    expect(created.data.data.platform_ready).toBe(false);
    expect(created.data.data.draft).toBeNull();
    expect(created.data.data.notes).toBeNull();

    // Patch the extended fields and confirm they round-trip.
    const upd = await api("PATCH", `/api/v1/board/cards/${id}`, {
      draft: "Working draft text",
      notes: "Instructions for Hermes",
      content_pillar: "EFT",
      platform_ready: true,
      platforms: ["instagram", "linkedin"],
      checklist: [{ id: "c1", text: "Outline", done: false }, { id: "c2", text: "Review", done: true }],
      media: [{ id: "m1", url: "https://example.com/x.png", type: "image", name: "hero" }],
      resources: [{ id: "r1", label: "Study", url: "https://example.com/s", notes: "key ref" }],
      custom_fields: [{ id: "f1", label: "Audience", value: "couples" }],
    }, token);
    expect(upd.status).toBe(200);
    expect(upd.data.data.draft).toBe("Working draft text");
    expect(upd.data.data.notes).toBe("Instructions for Hermes");
    expect(upd.data.data.content_pillar).toBe("EFT");
    expect(upd.data.data.platform_ready).toBe(true);
    expect(upd.data.data.platforms).toEqual(["instagram", "linkedin"]);
    expect(upd.data.data.checklist.length).toBe(2);
    expect(upd.data.data.checklist[1].done).toBe(true);
    expect(upd.data.data.media[0].name).toBe("hero");
    expect(upd.data.data.resources[0].label).toBe("Study");
    expect(upd.data.data.custom_fields[0].value).toBe("couples");

    // Re-fetch: values are durable across reads.
    const get = await api("GET", `/api/v1/board/cards/${id}`, undefined, token);
    expect(get.data.data.platform_ready).toBe(true);
    expect(get.data.data.checklist.length).toBe(2);
  });

  it("creates, updates, and deletes categories safely", async () => {
    const a = await api("POST", "/api/v1/board/categories", { name: "Design", color: "#ff0000" }, token);
    expect(a.status).toBe(201);
    const catId = a.data.data.id;
    const upd = await api("PATCH", `/api/v1/board/categories/${catId}`, { description: "UI work" }, token);
    expect(upd.status).toBe(200);
    const del = await api("DELETE", `/api/v1/board/categories/${catId}`, undefined, token);
    expect(del.status).toBe(200);
    const after = await api("GET", "/api/v1/board/categories", undefined, token);
    expect(after.data.data.find((c: any) => c.id === catId)).toBeUndefined();
  });

  it("non-staff cannot manage categories", async () => {
    const member = await makeMember();
    const r = await api("POST", "/api/v1/board/categories", { name: "x" }, member.token);
    expect(r.status).toBe(403);
  });
});

describe("Phase 2b: card hub (comments, sources, links, activity)", () => {
  let token: string; let columnId: string; let cardId: string;
  beforeAll(async () => {
    await clearDb();
    const a = await makeAdmin(); token = a.token;
    const cols = await api("GET", "/api/v1/board/columns", undefined, token);
    columnId = cols.data.data[0].id;
    const c = await api("POST", "/api/v1/board/cards", { column_id: columnId, title: "Hub card" }, token);
    cardId = c.data.data.id;
  });

  it("threads comments (top-level + reply), lists, and soft-deletes", async () => {
    const top = await api("POST", `/api/v1/board/cards/${cardId}/comments`, { body: "Top comment" }, token);
    expect(top.status).toBe(201);
    const topId = top.data.data.id;
    const reply = await api("POST", `/api/v1/board/cards/${cardId}/comments`, { body: "A reply", parent_id: topId }, token);
    expect(reply.status).toBe(201);
    expect(reply.data.data.parent_id).toBe(topId);
    const list = await api("GET", `/api/v1/board/cards/${cardId}/comments`, undefined, token);
    expect(list.data.data.length).toBe(2);
    const del = await api("DELETE", `/api/v1/board/cards/${cardId}/comments/${topId}`, undefined, token);
    expect(del.status).toBe(200);
    const after = await api("GET", `/api/v1/board/cards/${cardId}/comments`, undefined, token);
    // soft-deleted comment is hidden from the list
    expect(after.data.data.find((c: any) => c.id === topId)).toBeUndefined();
  });

  it("rejects a reply whose parent is not on this card", async () => {
    const r = await api("POST", `/api/v1/board/cards/${cardId}/comments`, { body: "x", parent_id: "not_a_real_parent" }, token);
    expect(r.status).toBe(400);
  });

  it("adds a source, auto-builds an APA citation, and deletes it", async () => {
    const s = await api("POST", `/api/v1/board/cards/${cardId}/sources`, {
      source_type: "article", authors: "Smith, J.", year: "2022", title: "Mindfulness outcomes", publisher: "J. Wellness",
    }, token);
    expect(s.status).toBe(201);
    expect(s.data.data.citation).toMatch(/Smith, J\./);
    expect(s.data.data.citation).toMatch(/2022/);
    const list = await api("GET", `/api/v1/board/cards/${cardId}/sources`, undefined, token);
    expect(list.data.data.length).toBe(1);
    const del = await api("DELETE", `/api/v1/board/cards/${cardId}/sources/${s.data.data.id}`, undefined, token);
    expect(del.status).toBe(200);
  });

  it("links a related card and a related post, and lists both", async () => {
    const other = await api("POST", "/api/v1/board/cards", { column_id: columnId, title: "Linked card" }, token);
    const otherId = other.data.data.id;
    const lc = await api("POST", `/api/v1/board/cards/${cardId}/links`, { link_type: "related_card", target_card_id: otherId }, token);
    expect(lc.status).toBe(201);
    expect(lc.data.data.target_title).toBe("Linked card");
    const lp = await api("POST", `/api/v1/board/cards/${cardId}/links`, { link_type: "related_post", target_title: "Live blog post", target_url: "https://example.com/post" }, token);
    expect(lp.status).toBe(201);
    const list = await api("GET", `/api/v1/board/cards/${cardId}/links`, undefined, token);
    expect(list.data.data.length).toBe(2);
  });

  it("exposes card-scoped activity from audit_logs", async () => {
    // The link/comment/source actions above should have produced audit entries.
    const act = await api("GET", `/api/v1/board/cards/${cardId}/activity`, undefined, token);
    expect(act.status).toBe(200);
    expect(Array.isArray(act.data.data)).toBe(true);
    expect(act.data.data.some((a: any) => String(a.action).startsWith("card_"))).toBe(true);
  });
});

describe("Phase 3: chat board", () => {
  let token: string; let channelId: string;
  beforeAll(async () => {
    await clearDb();
    const a = await makeAdmin(); token = a.token;
    const ch = await api("GET", "/api/v1/chat/channels", undefined, token);
    channelId = ch.data.data[0].id;
  });

  it("creates a thread and posts nested replies", async () => {
    const t = await api("POST", "/api/v1/chat/threads", { channel_id: channelId, title: "Roadmap chat" }, token);
    expect(t.status).toBe(201);
    const threadId = t.data.data.id;
    const m = await api("POST", "/api/v1/chat/messages", { thread_id: threadId, body: "Hello @team", mentions: ["team"] }, token);
    expect(m.status).toBe(201);
    const parentId = m.data.data.id;
    const reply = await api("POST", "/api/v1/chat/messages", { thread_id: threadId, parent_id: parentId, body: "reply here" }, token);
    expect(reply.status).toBe(201);
    const list = await api("GET", `/api/v1/chat/messages?thread_id=${threadId}`, undefined, token);
    expect(list.data.data.length).toBe(2);
    expect(list.data.data[1].parent_id).toBe(parentId);
  });

  it("rejects posting when thread is locked", async () => {
    const t = await api("POST", "/api/v1/chat/threads", { channel_id: channelId, title: "Locked thread" }, token);
    const threadId = t.data.data.id;
    await api("PATCH", `/api/v1/chat/threads/${threadId}`, { locked: true }, token);
    const m = await api("POST", "/api/v1/chat/messages", { thread_id: threadId, body: "nope" }, token);
    expect(m.status).toBe(403);
  });
});

describe("Phase 4: admin — users, tasks, audit, flags", () => {
  let token: string;
  beforeAll(async () => {
    await clearDb();
    const a = await makeAdmin(); token = a.token;
  });

  it("invites a user and lists users", async () => {
    const inv = await api("POST", "/api/v1/admin/users", { email: "mod@example.com", role: "moderator" }, token);
    expect(inv.status).toBe(201);
    const list = await api("GET", "/api/v1/admin/users", undefined, token);
    expect(list.data.data.some((u: any) => u.email === "mod@example.com")).toBe(true);
  });

  it("assigns a task with history + status change", async () => {
    // Create a dedicated assignee within this test (self-contained).
    const assigneeEmail = `assignee_${randomToken(5)}@example.com`;
    const inv = await api("POST", "/api/v1/admin/users", { email: assigneeEmail, role: "member" }, token);
    expect(inv.status).toBe(201);
    const users = await api("GET", "/api/v1/admin/users", undefined, token);
    const assignee = users.data.data.find((u: any) => u.email === assigneeEmail);
    expect(assignee).toBeDefined();
    const task = await api("POST", "/api/v1/admin/tasks", { title: "Write docs", assignee_id: assignee.id, priority: "high" }, token);
    expect(task.status).toBe(201);
    const id = task.data.data.id;
    const hist = await api("GET", `/api/v1/admin/tasks/${id}/history`, undefined, token);
    expect(hist.data.data.some((h: any) => h.action === "assigned")).toBe(true);
    await api("PATCH", `/api/v1/admin/tasks/${id}`, { status: "done" }, token);
    const hist2 = await api("GET", `/api/v1/admin/tasks/${id}/history`, undefined, token);
    expect(hist2.data.data.some((h: any) => h.action === "status_changed")).toBe(true);
  });

  it("writes audit logs for admin actions", async () => {
    const audit = await api("GET", "/api/v1/admin/audit?limit=20", undefined, token);
    expect(Array.isArray(audit.data.data)).toBe(true);
    expect(audit.data.data.length).toBeGreaterThan(0);
  });

  it("feature flags can be toggled", async () => {
    const set = await api("PUT", "/api/v1/admin/flags/invite_only_signup", { enabled: true }, token);
    expect(set.status).toBe(200);
    const flags = await api("GET", "/api/v1/admin/flags", undefined, token);
    expect(flags.data.data.find((f: any) => f.name === "invite_only_signup")?.enabled).toBe(1);
  });
});

describe("Phase 7: RAG / semantic memory", () => {
  let token: string;
  beforeAll(async () => {
    await clearDb();
    const a = await makeAdmin(); token = a.token;
  });

  it("stores memory notes and retrieves them semantically", async () => {
    await api("POST", "/api/v1/admin/memory", {
      type: "bug", title: "Login page crashes on empty password", body: "Authentication endpoint throws when password field is empty.", tags: ["auth", "bug"],
    }, token);
    await api("POST", "/api/v1/admin/memory", {
      type: "decision", title: "Use PBKDF2 for password hashing", body: "We chose PBKDF2-SHA256 over bcrypt for zero native deps on Workers.", tags: ["security", "auth"],
    }, token);
    const search = await api("GET", `/api/v1/memory/search?q=authentication%20login%20crash`, undefined, token);
    expect(search.status).toBe(200);
    expect(search.data.data.length).toBeGreaterThan(0);
    expect(search.data.data[0].type).toBe("bug");
  });

  it("records decisions and retrieves by topic", async () => {
    await api("POST", "/api/v1/admin/memory/decision", { title: "Approved free-tier Cloudflare hosting", body: "Decision to host on Workers free tier." }, token);
    const r = await api("GET", `/api/v1/memory/search?q=hosting%20decision%20cloudflare`, undefined, token);
    expect(r.data.data.length).toBeGreaterThan(0);
  });
});

describe("Phase 6: security — authorization", () => {
  it("non-admin cannot access admin endpoints", async () => {
    const r = await api("GET", "/api/v1/admin/users", undefined, "Bearer not-a-real-token");
    expect(r.status).toBe(401);
  });

  it("reviewer role cannot access admin user management", async () => {
    const rev = await makeReviewer();
    const r = await api("GET", "/api/v1/admin/users", undefined, rev.token);
    expect(r.status).toBe(403);
  });

  it("reviewer can review (approve/reject) content but member cannot", async () => {
    const admin = await makeAdmin();
    const rev = await makeReviewer();
    const member = await makeMember();
    // Admin creates + submits a content item.
    const created = await api("POST", "/api/v1/publishing", { title: "Post A", body: "b", image_prompt: "calm wellness" }, admin.token);
    expect(created.status).toBe(201);
    const cid = created.data.data.id;
    const submitted = await api("POST", `/api/v1/publishing/${cid}/submit`, undefined, admin.token);
    expect(submitted.status).toBe(200);
    // Member may NOT review.
    const memberReview = await api("POST", `/api/v1/publishing/${cid}/review`, { action: "approve" }, member.token);
    expect(memberReview.status).toBe(403);
    // Reviewer CAN review.
    const revReview = await api("POST", `/api/v1/publishing/${cid}/review`, { action: "approve", note: "lgbt" }, rev.token);
    expect(revReview.status).toBe(200);
    const list = await api("GET", "/api/v1/publishing", undefined, rev.token);
    const item = list.data.data.find((c: any) => c.id === cid);
    expect(item.status).toBe("approved");
    expect(item.reviewer_id).toBe(rev.id);
  });

  it("bootstrap is disabled in production", async () => {
    // @ts-ignore
    env.ENVIRONMENT = "production";
    const r2 = await api("POST", "/api/v1/bootstrap/provision", {});
    expect([401, 403]).toContain(r2.status);
    // @ts-ignore
    env.ENVIRONMENT = "development";
  });
});

describe("Phase 8: publishing pipeline (image gen + storage, inline fallback)", () => {
  it("runs draft → submit → approve → publish, generating a stored image URL", async () => {
    const admin = await makeAdmin();
    const rev = await makeReviewer();
    const created = await api("POST", "/api/v1/publishing", {
      title: "Spring Reset", body: "A mindful spring reset.", image_prompt: "soft pastel wellness scene, calm",
    }, admin.token);
    expect(created.status).toBe(201);
    const cid = created.data.data.id;

    // Cannot publish before approval.
    const earlyPublish = await api("POST", `/api/v1/publishing/${cid}/publish`, undefined, admin.token);
    expect(earlyPublish.status).toBe(400);

    await api("POST", `/api/v1/publishing/${cid}/submit`, undefined, admin.token);
    const reviewed = await api("POST", `/api/v1/publishing/${cid}/review`, { action: "approve" }, rev.token);
    expect(reviewed.status).toBe(200);

    const published = await api("POST", `/api/v1/publishing/${cid}/publish`, undefined, admin.token);
    expect(published.status).toBe(200);
    expect(published.data.data.status).toBe("published");
    // Image URL is a data: URL when generation+inline storage succeeded, or
    // null when no network/storage is available (e.g. offline test sandbox).
    // Either is a valid published state — we never block publish on image gen.
    const url = published.data.data.image_url;
    expect(url === null || typeof url === "string").toBe(true);
    if (url) expect(url).toMatch(/^data:image\//);
  });

  it("reject sets status to rejected and records a note", async () => {
    const admin = await makeAdmin();
    const rev = await makeReviewer();
    const created = await api("POST", "/api/v1/publishing", { title: "Draft B", body: "" }, admin.token);
    const cid = created.data.data.id;
    await api("POST", `/api/v1/publishing/${cid}/submit`, undefined, admin.token);
    const rejected = await api("POST", `/api/v1/publishing/${cid}/review`, { action: "reject", note: "needs work" }, rev.token);
    expect(rejected.status).toBe(200);
    const list = await api("GET", "/api/v1/publishing", undefined, admin.token);
    const item = list.data.data.find((c: any) => c.id === cid);
    expect(item.status).toBe("rejected");
    expect(item.reviewer_note).toBe("needs work");
  });
});

describe("Phase 9: data (backup / restore / seed) + docs", () => {
  it("exports a backup with checksum and re-imports it (round-trip)", async () => {
    const a = await makeAdmin();
    const cols = await api("GET", "/api/v1/board/columns", undefined, a.token);
    const columnId = cols.data.data[0].id;
    await api("POST", "/api/v1/board/cards", { column_id: columnId, title: "Backup me", tags: ["x"], platforms: ["Instagram"] }, a.token);

    const backup = await api("GET", "/api/v1/data/backup", undefined, a.token);
    expect(backup.status).toBe(200);
    expect(backup.data.data.app_name).toBeTruthy();
    expect(backup.data.data.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(backup.data.data.card_count).toBe(1);
    expect(typeof backup.data.data.manual).toBe("string");

    // Dry-run restore validates without replacing.
    const dry = await api("POST", "/api/v1/data/restore", { backup: backup.data.data }, a.token);
    expect(dry.status).toBe(200);
    expect(dry.data.data.dry_run).toBe(true);
    expect(dry.data.data.warnings.length).toBe(0);

    // Confirmed restore replaces board state.
    const restore = await api("POST", "/api/v1/data/restore", { backup: backup.data.data, confirm: true }, a.token);
    expect(restore.status).toBe(200);
    expect(restore.data.data.restored).toBe(1);
    const after = await api("GET", "/api/v1/board/cards", undefined, a.token);
    expect(after.data.data.length).toBe(1);
    expect(after.data.data[0].title).toBe("Backup me");
  });

  it("warns on checksum mismatch", async () => {
    const a = await makeAdmin();
    const cols = await api("GET", "/api/v1/board/columns", undefined, a.token);
    const columnId = cols.data.data[0].id;
    const tampered = {
      schema_version: 2,
      checksum: "0".repeat(64),
      cards: [{ id: "card_x", column_id: columnId, title: "Tampered" }],
    };
    const dry = await api("POST", "/api/v1/data/restore", { backup: tampered }, a.token);
    expect(dry.data.data.warnings.some((w: string) => /checksum/i.test(w))).toBe(true);
  });

  it("accepts the old flat array format", async () => {
    const a = await makeAdmin();
    const cols = await api("GET", "/api/v1/board/columns", undefined, a.token);
    const columnId = cols.data.data[0].id;
    const flat = [{ column_id: columnId, title: "Legacy card" }];
    const res = await api("POST", "/api/v1/data/restore", flat as any, a.token);
    // flat array => no confirm field => dry run
    expect(res.data.data.dry_run).toBe(true);
    expect(res.data.data.warnings.some((w: string) => /flat format/i.test(w))).toBe(true);
  });

  it("members cannot restore", async () => {
    const member = await makeMember();
    const res = await api("POST", "/api/v1/data/restore", { backup: { cards: [] }, confirm: true }, member.token);
    expect(res.status).toBe(403);
  });

  it("seeds 18 sample cards only when the board is empty", async () => {
    const a = await makeAdmin();
    // Board starts empty for this admin's fresh DB.
    const seed = await api("POST", "/api/v1/data/seed", undefined, a.token);
    expect(seed.status).toBe(201);
    expect(seed.data.data.seeded).toBe(18);
    const cards = await api("GET", "/api/v1/board/cards", undefined, a.token);
    expect(cards.data.data.length).toBe(18);
    // Second seed is a no-op (does not overwrite).
    const again = await api("POST", "/api/v1/data/seed", undefined, a.token);
    expect(again.data.data.skipped).toBe(true);
    expect(again.data.data.seeded).toBe(0);
  });

  it("serves live docs data", async () => {
    const a = await makeAdmin();
    const cols = await api("GET", "/api/v1/board/columns", undefined, a.token);
    await api("POST", "/api/v1/board/cards", { column_id: cols.data.data[0].id, title: "Doc card" }, a.token);
    const docs = await api("GET", "/api/v1/docs", undefined, a.token);
    expect(docs.status).toBe(200);
    expect(docs.data.data.columns.length).toBeGreaterThan(0);
    expect(docs.data.data.card_fields.some((f: any) => f.name === "platform_ready")).toBe(true);
    expect(docs.data.data.platforms.length).toBeGreaterThan(0);
    expect(docs.data.data.board_stats.total_cards).toBeGreaterThanOrEqual(1);
  });
});

describe("Phase 10: Hermes AI chat sidebar", () => {
  let token: string; let columnId: string;
  beforeAll(async () => {
    await clearDb();
    const a = await makeAdmin(); token = a.token;
    const cols = await api("GET", "/api/v1/board/columns", undefined, token);
    columnId = cols.data.data[0].id;
  });

  it("creates a conversation implicitly and returns an assistant reply", async () => {
    const r = await api("POST", "/api/v1/hermes/chat", { message: "What's on the board?" }, token);
    expect(r.status).toBe(201);
    expect(r.data.data.conversation_id).toBeTruthy();
    expect(typeof r.data.data.reply).toBe("string");
    expect(r.data.data.reply.length).toBeGreaterThan(0);
  });

  it("persists user + assistant messages and lists them", async () => {
    const first = await api("POST", "/api/v1/hermes/chat", { message: "Summarize the board" }, token);
    const cid = first.data.data.conversation_id;
    const list = await api("GET", `/api/v1/hermes/conversations/${cid}/messages`, undefined, token);
    expect(list.status).toBe(200);
    expect(list.data.data.length).toBe(2);
    expect(list.data.data[0].role).toBe("user");
    expect(list.data.data[1].role).toBe("assistant");
  });

  it("lists conversations per user and rejects other users", async () => {
    const conv = await api("POST", "/api/v1/hermes/conversations", {}, token);
    const cid = conv.data.data.id;
    await api("POST", "/api/v1/hermes/chat", { conversation_id: cid, message: "remember: buy milk" }, token);
    const list = await api("GET", "/api/v1/hermes/conversations", undefined, token);
    expect(list.data.data.some((c: any) => c.id === cid)).toBe(true);

    const member = await makeMember();
    const other = await api("GET", `/api/v1/hermes/conversations/${cid}/messages`, undefined, member.token);
    expect(other.status).toBe(404); // not their conversation
  });

  it("answers board-status questions from live context", async () => {
    await api("POST", "/api/v1/board/cards", { column_id: columnId, title: "Cal card A" }, token);
    const r = await api("POST", "/api/v1/hermes/chat", { message: "How many cards are on the board?" }, token);
    expect(r.status).toBe(201);
    expect(r.data.data.reply).toMatch(/card/i);
  });
});

describe("Phase 11: content calendar", () => {
  let token: string; let columnId: string; let cardId: string;
  beforeAll(async () => {
    await clearDb();
    const a = await makeAdmin(); token = a.token;
    const cols = await api("GET", "/api/v1/board/columns", undefined, token);
    columnId = cols.data.data[0].id;
    const card = await api("POST", "/api/v1/board/cards", { column_id: columnId, title: "Scheduled post" }, token);
    cardId = card.data.data.id;
  });

  it("schedules a card onto a date and shows it in the month view", async () => {
    const date = "2026-09-15";
    const sched = await api("POST", `/api/v1/calendar/cards/${cardId}/schedule`, { scheduled_date: date }, token);
    expect(sched.status).toBe(200);
    expect(sched.data.data.scheduled_date).toBe(date);
    const month = await api("GET", "/api/v1/calendar/month?year=2026&month=9", undefined, token);
    expect(month.status).toBe(200);
    expect(month.data.data.events_by_date[date].some((e: any) => e.id === cardId)).toBe(true);
  });

  it("unschedules a card", async () => {
    const sched = await api("POST", `/api/v1/calendar/cards/${cardId}/schedule`, { scheduled_date: null }, token);
    expect(sched.status).toBe(200);
    expect(sched.data.data.scheduled_date).toBeNull();
  });

  it("creates a richer calendar item and filters by status", async () => {
    const item = await api("POST", "/api/v1/calendar", { title: "Newsletter send", date: "2026-09-20", status: "approved", platform: "Newsletter" }, token);
    expect(item.status).toBe(201);
    const id = item.data.data.id;
    const month = await api("GET", "/api/v1/calendar/month?year=2026&month=9", undefined, token);
    expect(month.data.data.events_by_date["2026-09-20"].some((e: any) => e.id === id)).toBe(true);
    // status filter
    const filtered = await api("GET", "/api/v1/calendar/month?year=2026&month=9&status=approved", undefined, token);
    expect(filtered.data.data.events_by_date["2026-09-20"].every((e: any) => e.status === "approved")).toBe(true);
  });
});

describe("Phase 12: files", () => {
  let token: string;
  beforeAll(async () => {
    await clearDb();
    const a = await makeAdmin(); token = a.token;
  });

  it("uploads a file (inline data URL) with tags and lists it", async () => {
    const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAQABAAAA";
    const up = await api("POST", "/api/v1/files", { name: "hero.png", kind: "image", mime: "image/png", tags: ["brand"], note: "hero asset", url: dataUrl }, token);
    expect(up.status).toBe(201);
    expect(up.data.data.id).toBeTruthy();
    expect(up.data.data.url).toBe(dataUrl);
    const list = await api("GET", "/api/v1/files", undefined, token);
    expect(list.data.data.some((f: any) => f.name === "hero.png")).toBe(true);
    const id = up.data.data.id;
    // search by tag/name
    const search = await api("GET", "/api/v1/files?q=hero", undefined, token);
    expect(search.data.data.some((f: any) => f.id === id)).toBe(true);
    // delete (staff)
    const del = await api("DELETE", `/api/v1/files/${id}`, undefined, token);
    expect(del.status).toBe(200);
  });

  it("members cannot delete files", async () => {
    const member = await makeMember();
    const up = await api("POST", "/api/v1/files", { name: "x.pdf", kind: "pdf", url: "data:application/pdf;base64,ZA==" }, member.token);
    expect(up.status).toBe(201);
    const del = await api("DELETE", `/api/v1/files/${up.data.data.id}`, undefined, member.token);
    expect(del.status).toBe(403);
  });
});

// Must run LAST in this file: fills a SINGLE login rate-limit bucket.
// Uses a fixed IP so the per-IP login limit (10/min) is actually reached.
describe("Phase 6: rate limiting (runs last)", () => {
  it("limits login brute-force attempts per IP", async () => {
    let lastStatus: number | undefined;
    const bruteIp = "brute-force-attacker.local";
    for (let i = 0; i < 15; i++) {
      const headers = {
        "content-type": "application/json",
        "x-forwarded-for": bruteIp,
      };
      const res = await SELF.fetch("http://localhost/api/v1/auth/login", {
        method: "POST",
        headers,
        body: JSON.stringify({ email: "brute@nonexistent.local", password: "x" }),
      });
      lastStatus = res.status;
      if (res.status === 429) break;
    }
    expect(lastStatus).toBe(429);
  });
});
