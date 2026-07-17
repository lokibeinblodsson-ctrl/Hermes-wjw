// User data-access helpers.
import type { D1Database } from "@cloudflare/workers-types";
import { all, first, toJson, jsonField } from "./db";
import type { User, Role } from "../lib/types";

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  role: string;
  status: string;
  email_verified: number;
  force_reset: number;
  token_version: number;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
  failed_logins: number;
  locked_until: string | null;
}

export function rowToUser(r: UserRow): User {
  return {
    id: r.id,
    email: r.email,
    display_name: r.display_name,
    role: r.role as Role,
    status: r.status as User["status"],
    email_verified: !!r.email_verified,
    force_reset: !!r.force_reset,
    token_version: r.token_version,
    created_at: r.created_at,
    updated_at: r.updated_at,
    last_login_at: r.last_login_at,
    failed_logins: r.failed_logins ?? 0,
    locked_until: r.locked_until ?? null,
  };
}

export async function getUserById(db: D1Database, id: string): Promise<User | null> {
  const r = await first<UserRow>(db, `SELECT * FROM users WHERE id = ?`, [id]);
  return r ? rowToUser(r) : null;
}

export async function getUserByEmail(db: D1Database, email: string): Promise<User | null> {
  const r = await first<UserRow>(db, `SELECT * FROM users WHERE lower(email) = lower(?)`, [email]);
  return r ? rowToUser(r) : null;
}

export async function listUsers(db: D1Database): Promise<User[]> {
  const rs = await all<UserRow>(db, `SELECT * FROM users ORDER BY created_at DESC`);
  return rs.map(rowToUser);
}

export async function getPasswordHash(db: D1Database, userId: string): Promise<string | null> {
  const r = await first<{ password_hash: string }>(
    db,
    `SELECT password_hash FROM users WHERE id = ?`,
    [userId]
  );
  return r ? r.password_hash : null;
}

export async function setPasswordHash(db: D1Database, userId: string, hash: string): Promise<void> {
  await db
    .prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`)
    .bind(hash, new Date().toISOString(), userId)
    .run();
}

export async function bumpTokenVersion(db: D1Database, userId: string): Promise<number> {
  const r = await first<{ token_version: number }>(
    db,
    `UPDATE users SET token_version = token_version + 1, updated_at = ? WHERE id = ? RETURNING token_version`,
    [new Date().toISOString(), userId]
  );
  return r ? r.token_version : 0;
}

// Resolve the full session user (from DB, not just JWT) for sensitive actions.
export async function resolveSession(
  db: D1Database,
  jwtSub: string,
  jwtTv: number
): Promise<User | null> {
  const u = await getUserById(db, jwtSub);
  if (!u) return null;
  if (u.token_version !== jwtTv) return null; // invalidated session
  if (u.status === "disabled" || u.status === "suspended") return null;
  return u;
}

export { toJson, jsonField };
