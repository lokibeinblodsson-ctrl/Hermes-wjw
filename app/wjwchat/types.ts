// ── WJW Chat data model ────────────────────────────────────────────────────
// Original types for a mock, local-first team chat. Designed so a real API can
// be swapped in later: every entity has a stable string id and plain JSON shape.

export type PresenceStatus = "online" | "away" | "offline";

export interface User {
  id: string;
  name: string;
  handle: string;
  avatarColor: string; // soft brand color for the generated initial-avatar
  presence: PresenceStatus;
  title?: string;
}

export type ConversationKind = "channel" | "dm";

export interface Channel {
  id: string;
  kind: "channel";
  name: string;
  description?: string;
  section: string; // e.g. "Teams", "Projects"
  muted?: boolean;
  memberCount: number;
}

export interface DirectMessage {
  id: string;
  kind: "dm";
  userId: string; // the other person
}

export type Conversation = Channel | DirectMessage;

export interface Attachment {
  id: string;
  kind: "image" | "file" | "link";
  name: string;
  url?: string;
  mime?: string;
  size?: string;
  // For inline generated image previews (no external assets): a gradient pair.
  swatch?: [string, string];
}

export interface Reaction {
  emoji: string;
  userIds: string[];
}

export interface ThreadReply {
  id: string;
  senderId: string;
  text: string;
  createdAt: string;
}

export type DeliveryStatus = "sending" | "sent" | "failed";

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  createdAt: string;
  editedAt?: string;
  replyCount: number;
  threadParticipants?: string[];
  reactions: Reaction[];
  attachments?: Attachment[];
  isSaved?: boolean;
  deliveryStatus: DeliveryStatus;
  // true for seeded messages that have already been "read" on first load
  seeded?: boolean;
}

export interface Notification {
  id: string;
  kind: "mention" | "thread_reply" | "reaction";
  conversationId: string;
  messageId: string;
  actorId: string; // who triggered it
  text: string;
  createdAt: string;
  read?: boolean;
}

export type ThemeMode = "light" | "dark";
export type PrimaryView = "home" | "activity" | "saved";

export interface Workspace {
  id: string;
  name: string;
  accent: string;
}
