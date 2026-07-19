// Channel membership data-access helpers.
//
// Per-user access grants for private channels (migration 0005). Access to a
// private channel is: role in channels.allowed_roles OR a row here. The pure
// decision lives in lib/permissions.ts (canReadChannel); this module only
// loads the facts it needs.
import type { D1Database } from "@cloudflare/workers-types";
import { randomId, nowIso } from "../lib/crypto";
import { first, all } from "./db";

export async function isChannelMember(
  db: D1Database,
  channelId: string,
  userId: string
): Promise<boolean> {
  const r = await first<{ id: string }>(
    db,
    `SELECT id FROM channel_members WHERE channel_id = ? AND user_id = ?`,
    [channelId, userId]
  );
  return !!r;
}

// Channel ids the user has an explicit membership row for. Used to widen the
// visible-channel list beyond role-based access in one query.
export async function memberChannelIds(db: D1Database, userId: string): Promise<Set<string>> {
  const rs = await all<{ channel_id: string }>(
    db,
    `SELECT channel_id FROM channel_members WHERE user_id = ?`,
    [userId]
  );
  return new Set(rs.map((r) => r.channel_id));
}

export interface ChannelMemberRow {
  id: string;
  channel_id: string;
  user_id: string;
  added_by: string | null;
  created_at: string;
  display_name: string;
  email: string;
  role: string;
}

export async function listChannelMembers(
  db: D1Database,
  channelId: string
): Promise<ChannelMemberRow[]> {
  return all<ChannelMemberRow>(
    db,
    `SELECT cm.*, u.display_name, u.email, u.role
     FROM channel_members cm JOIN users u ON u.id = cm.user_id
     WHERE cm.channel_id = ? ORDER BY u.display_name`,
    [channelId]
  );
}

export async function addChannelMember(
  db: D1Database,
  channelId: string,
  userId: string,
  addedBy: string
): Promise<void> {
  // Idempotent: UNIQUE(channel_id,user_id) makes a repeat add a no-op.
  await db
    .prepare(
      `INSERT INTO channel_members (id, channel_id, user_id, added_by, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(channel_id, user_id) DO NOTHING`
    )
    .bind(randomId("cmb"), channelId, userId, addedBy, nowIso())
    .run();
}

export async function removeChannelMember(
  db: D1Database,
  channelId: string,
  userId: string
): Promise<void> {
  await db
    .prepare(`DELETE FROM channel_members WHERE channel_id = ? AND user_id = ?`)
    .bind(channelId, userId)
    .run();
}
