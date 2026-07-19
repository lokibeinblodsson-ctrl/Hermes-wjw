import type {
  User,
  Conversation,
  Message,
  Notification,
  Workspace,
} from "./types";
import { currentUser } from "../lib/api";

// ── Workspace ───────────────────────────────────────────────────────────────
export const workspace: Workspace = {
  id: "wsp_wjw",
  name: "Wild Jazmine Wellness",
  accent: "#8aa66f", // calm moss — matches the site --accent
};

// ── Current (self) user ──────────────────────────────────────────────────────
// Use the REAL signed-in account from the host app (no invented personas).
const real = currentUser();
export const CURRENT_USER_ID = real?.id || "usr_you";
export const CURRENT_USER_ROLE = real?.role || "member";
const meName = real?.display_name || "You";
const meTitle = real?.role ? `${real.role[0].toUpperCase()}${real.role.slice(1)}` : "Member";

// The only "people" in the chat are the real user and the Hermes assistant
// (a virtual participant). No fake/seed accounts remain.
export const users: User[] = [
  { id: CURRENT_USER_ID, name: meName, handle: "you", avatarColor: "#8aa66f", presence: "online", title: meTitle },
  { id: "usr_hermes", name: "Hermes", handle: "hermes", avatarColor: "#9cb881", presence: "online", title: "AI assistant" },
];

// ── Channels (the only real conversations) ──────────────────────────────────
export const conversations: Conversation[] = [
  { id: "chn_general", kind: "channel", name: "general", section: "Channels", description: "Everyday chatter and check-ins.", memberCount: 1 },
  { id: "chn_content", kind: "channel", name: "content-studio", section: "Channels", description: "Editorial calendar, drafts, and reviews.", memberCount: 1 },
  { id: "chn_support", kind: "channel", name: "support", section: "Channels", description: "Client care coordination.", memberCount: 1 },
  { id: "chn_announce", kind: "channel", name: "announcements", section: "Channels", description: "Studio-wide updates.", memberCount: 1 },
  // The Hermes assistant is a special channel you can talk to directly.
  { id: "chn_hermes", kind: "channel", name: "hermes", section: "Assistant", description: "Talk to Hermes — ask questions or request actions.", memberCount: 1, isAssistant: true },
];

// stable iso timestamps relative to "now" for realistic ordering
const now = Date.now();
const hrs = (h: number) => new Date(now - h * 3_600_000).toISOString();
const days = (d: number) => new Date(now - d * 86_400_000).toISOString();

// ── Messages ─────────────────────────────────────────────────────────────────
// Only the real user authors channel messages. The Hermes channel is driven
// live by the API (POST /hermes/chat) — no seeded bot text here.
export const seedMessages: Message[] = [
  msg("m_gen1", "chn_general", CURRENT_USER_ID, "Welcome to the Wild Jazmine Wellness workspace 👋 Use this space for day-to-day coordination.", hrs(26), { isSaved: true }),
  msg("m_gen2", "chn_general", CURRENT_USER_ID, "Tip: open #hermes to ask the assistant about the board, or request an action.", hrs(4)),

  msg("m_co1", "chn_content", CURRENT_USER_ID, "Draft for the 'EFT for sleep' carousel is in. Hook: \"You can't think your way out of a nervous system that thinks it's unsafe.\"", hrs(19)),
  msg("m_co2", "chn_content", CURRENT_USER_ID, "Softened 'unsafe' to 'on alert' after feedback — it lands calmer.", hrs(8)),

  msg("m_su1", "chn_support", CURRENT_USER_ID, "Client intake form goes live Monday. Double-check the confirmation email copy before then.", hrs(6)),

  msg("m_an1", "chn_announce", CURRENT_USER_ID, "Reminder: the booking calendar has a short maintenance window tonight. Nothing client-facing.", hrs(20)),
];

// thread replies (none seeded now — threads are created live by the user)
export const seedThreadReplies: Record<string, import("./types").ThreadReply[]> = {};

// ── Notifications (activity) ─────────────────────────────────────────────────
// Seeded notifications referenced fake accounts, so we start clean. New ones
// are generated live from real activity.
export const seedNotifications: Notification[] = [];

// ── helpers ──────────────────────────────────────────────────────────────────
function msg(
  id: string,
  conversationId: string,
  senderId: string,
  text: string,
  createdAt: string,
  extra: Partial<Message> = {},
): Message {
  return {
    id,
    conversationId,
    senderId,
    text,
    createdAt,
    reactions: [],
    replyCount: 0,
    deliveryStatus: "sent",
    seeded: true,
    ...extra,
  };
}
function rx(emoji: string, userIds: string[]) {
  return { emoji, userIds };
}
function att(id: string, kind: "image" | "file" | "link", name: string, url: string | undefined, swatch?: [string, string]) {
  return { id, kind, name, url, swatch };
}
