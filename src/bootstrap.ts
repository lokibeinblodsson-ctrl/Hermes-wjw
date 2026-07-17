// Idempotent admin provisioning. The admin identity is taken from ADMIN_EMAIL
// (placeholder identity). A cryptographically random password is generated here,
// hashed, stored, and force_reset is set so the admin must change it on first
// login. The raw password is returned exactly once to the provisioning caller.
import type { D1Database } from "@cloudflare/workers-types";
import { randomId, randomToken, hashPassword, nowIso, toBase64Url } from "./lib/crypto";
import { toJson } from "./db/db";
import { Env } from "./lib/env";

export interface SeedResult {
  created: boolean;
  email: string;
  userId?: string;
  temporaryPassword?: string;
  // Set true when the admin already existed but still had force_reset=1, and we
  // re-issued a fresh temporary password so it can complete first login.
  recovered?: boolean;
}

export async function seedAdminIfNeeded(env: Env, db: D1Database): Promise<SeedResult> {
  const email = (env.ADMIN_EMAIL || "admin@wildjazmine.local").trim();
  const existing = await db.prepare(`SELECT id, email, force_reset FROM users WHERE lower(email) = lower(?)`).bind(email).first();
  if (existing) {
    const row = existing as { id: string; email: string; force_reset: number };
    // Recovery: if the admin was seeded but never finished first login
    // (force_reset still set), re-issue a fresh temporary password so a local
    // operator can complete provisioning. Production disables bootstrap, so
    // this only matters on dev/local.
    if (row.force_reset) {
      const password = randomToken(16);
      const hash = await hashPassword(password);
      await db
        .prepare(`UPDATE users SET password_hash = ?, token_version = 0, failed_logins = 0, locked_until = NULL, updated_at = ? WHERE id = ?`)
        .bind(hash, nowIso(), row.id)
        .run();
      return { created: false, email: row.email, userId: row.id, temporaryPassword: password, recovered: true };
    }
    return { created: false, email: row.email };
  }
  const userId = randomId("usr");
  const password = randomToken(16); // random, strong, one-time
  const hash = await hashPassword(password);
  await db
    .prepare(
      `INSERT INTO users (id, email, display_name, password_hash, role, status, email_verified, force_reset, token_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'admin', 'active', 1, 1, 0, ?, ?)`
    )
    .bind(userId, email, "Administrator", hash, nowIso(), nowIso())
    .run();

  // Seed default board columns for a usable kanban out of the box.
  const defaults = [
    { id: randomId("col"), name: "Backlog", color: "#9a978c", pos: 0 },
    { id: randomId("col"), name: "To Do", color: "#9cb881", pos: 1 },
    { id: randomId("col"), name: "In Progress", color: "#d8c69a", pos: 2 },
    { id: randomId("col"), name: "Review", color: "#b3a394", pos: 3 },
    { id: randomId("col"), name: "Done", color: "#8aa66f", pos: 4 },
  ];
  for (const d of defaults) {
    await db
      .prepare(`INSERT INTO board_columns (id, name, position, color, created_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(d.id, d.name, d.pos, d.color, nowIso())
      .run();
  }

  // Seed a general channel for chat.
  await db
    .prepare(
      `INSERT INTO channels (id, name, description, is_private, allowed_roles_json, position, created_at)
       VALUES (?, 'general', 'General discussion', 0, ?, 0, ?)`
    )
    .bind(randomId("chn"), toJson([]), nowIso())
    .run();

  return { created: true, email, userId, temporaryPassword: password };
}

// Idempotently seed default board columns + a general channel. Safe to call
// repeatedly; it only inserts when the corresponding table is empty. This keeps
// the kanban board and chat usable even if the seeded rows are ever cleared.
export async function ensureDefaults(db: D1Database): Promise<void> {
  const colCount = await db.prepare(`SELECT count(*) as c FROM board_columns`).first();
  if (!(colCount as { c: number }).c) {
    const defaults = [
      { id: randomId("col"), name: "Backlog", color: "#9a978c", pos: 0 },
      { id: randomId("col"), name: "To Do", color: "#9cb881", pos: 1 },
      { id: randomId("col"), name: "In Progress", color: "#d8c69a", pos: 2 },
      { id: randomId("col"), name: "Review", color: "#b3a394", pos: 3 },
      { id: randomId("col"), name: "Done", color: "#8aa66f", pos: 4 },
    ];
    for (const d of defaults) {
      await db
        .prepare(`INSERT INTO board_columns (id, name, position, color, created_at) VALUES (?, ?, ?, ?, ?)`)
        .bind(d.id, d.name, d.pos, d.color, nowIso())
        .run();
    }
  }
  const chCount = await db.prepare(`SELECT count(*) as c FROM channels`).first();
  if (!(chCount as { c: number }).c) {
    await db
      .prepare(
        `INSERT INTO channels (id, name, description, is_private, allowed_roles_json, position, created_at)
         VALUES (?, 'general', 'General discussion', 0, ?, 0, ?)`
      )
      .bind(randomId("chn"), toJson([]), nowIso())
      .run();
  }
}
