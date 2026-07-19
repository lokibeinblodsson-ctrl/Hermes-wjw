-- Migration 0005: per-user channel membership for private channels.
--
-- Backstory: before this, private channels were gated ONLY by role
-- (channels.allowed_roles_json). That made it impossible to grant a single
-- specific user access to a private channel without widening a whole role, and
-- the thread/message read endpoints performed NO channel-privacy check at all
-- (an IDOR: any authenticated user could read a private channel's threads and
-- messages by id). This migration adds explicit per-user membership so access
-- to a private channel is: allowed by role OR listed in channel_members.
-- Public channels remain readable/postable by any active user.

CREATE TABLE IF NOT EXISTS channel_members (
  id          TEXT PRIMARY KEY,
  channel_id  TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  added_by    TEXT,
  created_at  TEXT NOT NULL,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE,
  FOREIGN KEY (added_by)   REFERENCES users(id)    ON DELETE SET NULL,
  UNIQUE (channel_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_members_channel ON channel_members(channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_members_user    ON channel_members(user_id);
