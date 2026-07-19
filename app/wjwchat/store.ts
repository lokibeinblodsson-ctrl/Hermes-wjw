import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  Message,
  Conversation,
  Notification,
  ThemeMode,
  ThreadReply,
  Reaction,
  PrimaryView,
} from "./types";
import {
  seedMessages,
  seedThreadReplies,
  seedNotifications,
  conversations as seedConversations,
  CURRENT_USER_ID,
} from "./seed";

// Conversations live in static seed (no add/remove for now); new channels can
// be created at runtime so we keep a mutable copy in state.
let cidCounter = 0;
const newId = (p: string) => `${p}_${Date.now().toString(36)}_${(cidCounter++).toString(36)}`;

interface DraftMap {
  [conversationId: string]: string;
}

interface ChatState {
  // data
  conversations: Conversation[];
  messages: Message[];
  threadReplies: Record<string, ThreadReply[]>;
  notifications: Notification[];
  currentUserId: string;

  // ui state (persisted)
  activeConversationId: string;
  primaryView: PrimaryView;
  theme: ThemeMode;
  sidebarCollapsed: boolean;
  threadPanelMessageId: string | null; // message whose thread is open
  searchOpen: boolean;
  menuOpen: boolean;

  // per-conversation persisted state
  drafts: DraftMap;
  readState: Record<string, boolean>; // conversationId -> read
  unreadCounts: Record<string, number>; // conversationId -> unread
  muted: Record<string, boolean>; // conversationId -> muted

  // actions
  setActiveConversation: (id: string) => void;
  setPrimaryView: (v: PrimaryView) => void;
  toggleTheme: () => void;
  toggleSidebar: () => void;
  setThreadPanel: (messageId: string | null) => void;
  setSearchOpen: (open: boolean) => void;
  setMenuOpen: (open: boolean) => void;

  setDraft: (conversationId: string, text: string) => void;
  sendMessage: (conversationId: string, text: string) => Promise<void>;
  retryMessage: (messageId: string) => Promise<void>;
  editMessage: (messageId: string, text: string) => void;
  toggleReaction: (messageId: string, emoji: string) => void;
  toggleSave: (messageId: string) => void;
  sendThreadReply: (messageId: string, text: string) => Promise<void>;

  createChannel: (name: string, section: string, description?: string) => void;
  markAllRead: (conversationId: string) => void;
  resetDemo: () => void;

  // selectors (kept as plain helpers below)
}

// simulate network latency for "sending"
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FAIL_RATE = 0.12; // ~1 in 8 messages fails, to exercise retry

function seedUnread(messages: Message[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const m of messages) {
    if (m.senderId === CURRENT_USER_ID) continue;
    if (!m.seeded) continue;
    // a couple of seeded convos start with unread to show the indicator
    const unreadConvs = new Set(["chn_launch", "dm_nova", "chn_social", "chn_content"]);
    if (unreadConvs.has(m.conversationId)) {
      counts[m.conversationId] = (counts[m.conversationId] || 0) + 1;
    }
  }
  return counts;
}

const initialUnread = seedUnread(seedMessages);

export const useChat = create<ChatState>()(
  persist(
    (set, get) => ({
      conversations: seedConversations,
      messages: seedMessages,
      threadReplies: seedThreadReplies,
      notifications: seedNotifications,
      currentUserId: CURRENT_USER_ID,

      activeConversationId: "chn_general",
      primaryView: "home",
      theme: "light",
      sidebarCollapsed: false,
      threadPanelMessageId: null,
      searchOpen: false,
      menuOpen: false,

      drafts: {},
      readState: {},
      unreadCounts: initialUnread,
      muted: Object.fromEntries(seedConversations.filter((c) => "muted" in c && c.muted).map((c) => [c.id, true])),

      setActiveConversation: (id) => {
        set({ activeConversationId: id, primaryView: "home", threadPanelMessageId: null });
        get().markAllRead(id);
      },
      setPrimaryView: (v) => set({ primaryView: v, threadPanelMessageId: null }),
      toggleTheme: () => set((s) => ({ theme: s.theme === "light" ? "dark" : "light" })),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setThreadPanel: (messageId) => set({ threadPanelMessageId: messageId }),
      setSearchOpen: (open) => set({ searchOpen: open }),
      setMenuOpen: (open) => set({ menuOpen: open }),

      setDraft: (conversationId, text) =>
        set((s) => ({ drafts: { ...s.drafts, [conversationId]: text } })),

      sendMessage: async (conversationId, text) => {
        const id = newId("msg");
        const message: Message = {
          id,
          conversationId,
          senderId: get().currentUserId,
          text,
          createdAt: new Date().toISOString(),
          reactions: [],
          replyCount: 0,
          deliveryStatus: "sending",
        };
        set((s) => ({
          messages: [...s.messages, message],
          drafts: { ...s.drafts, [conversationId]: "" },
        }));
        await wait(650 + Math.random() * 500);
        const failed = Math.random() < FAIL_RATE;
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === id ? { ...m, deliveryStatus: failed ? "failed" : "sent" } : m
          ),
        }));
      },

      retryMessage: async (messageId) => {
        set((s) => ({
          messages: s.messages.map((m) => (m.id === messageId ? { ...m, deliveryStatus: "sending" } : m)),
        }));
        await wait(500 + Math.random() * 400);
        const failed = Math.random() < FAIL_RATE / 2;
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === messageId ? { ...m, deliveryStatus: failed ? "failed" : "sent" } : m
          ),
        }));
      },

      editMessage: (messageId, text) =>
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === messageId
              ? { ...m, text, editedAt: new Date().toISOString() }
              : m
          ),
        })),

      toggleReaction: (messageId, emoji) =>
        set((s) => ({
          messages: s.messages.map((m) => {
            if (m.id !== messageId) return m;
            const me = s.currentUserId;
            const existing = m.reactions.find((r) => r.emoji === emoji);
            let reactions: Reaction[];
            if (!existing) {
              reactions = [...m.reactions, { emoji, userIds: [me] }];
            } else if (existing.userIds.includes(me)) {
              const userIds = existing.userIds.filter((u) => u !== me);
              reactions = userIds.length
                ? m.reactions.map((r) => (r.emoji === emoji ? { ...r, userIds } : r))
                : m.reactions.filter((r) => r.emoji !== emoji);
            } else {
              reactions = m.reactions.map((r) =>
                r.emoji === emoji ? { ...r, userIds: [...r.userIds, me] } : r
              );
            }
            return { ...m, reactions };
          }),
        })),

      toggleSave: (messageId) =>
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === messageId ? { ...m, isSaved: !m.isSaved } : m
          ),
        })),

      sendThreadReply: async (messageId, text) => {
        const reply: ThreadReply = {
          id: newId("tr"),
          senderId: get().currentUserId,
          text,
          createdAt: new Date().toISOString(),
        };
        set((s) => ({
          threadReplies: {
            ...s.threadReplies,
            [messageId]: [...(s.threadReplies[messageId] || []), reply],
          },
          messages: s.messages.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  replyCount: (m.replyCount || 0) + 1,
                  threadParticipants: Array.from(
                    new Set([...(m.threadParticipants || []), get().currentUserId])
                  ),
                }
              : m
          ),
        }));
        await wait(300);
      },

      createChannel: (name, section, description) => {
        const id = newId("chn");
        const conv: Conversation = {
          id,
          kind: "channel",
          name: name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""),
          section,
          description: description || "",
          memberCount: 1,
        };
        set((s) => ({ conversations: [...s.conversations, conv] }));
        get().setActiveConversation(id);
      },

      markAllRead: (conversationId) =>
        set((s) => ({
          unreadCounts: { ...s.unreadCounts, [conversationId]: 0 },
          readState: { ...s.readState, [conversationId]: true },
        })),

      resetDemo: () =>
        set({
          conversations: seedConversations,
          messages: seedMessages,
          threadReplies: seedThreadReplies,
          notifications: seedNotifications,
          activeConversationId: "chn_general",
          primaryView: "home",
          threadPanelMessageId: null,
          drafts: {},
          readState: {},
          unreadCounts: initialUnread,
          muted: Object.fromEntries(
            seedConversations.filter((c) => "muted" in c && c.muted).map((c) => [c.id, true])
          ),
        }),
    }),
    {
      name: "wjw-chat-demo-v1",
      partialize: (s) => ({
        messages: s.messages,
        threadReplies: s.threadReplies,
        notifications: s.notifications,
        conversations: s.conversations,
        activeConversationId: s.activeConversationId,
        primaryView: s.primaryView,
        theme: s.theme,
        sidebarCollapsed: s.sidebarCollapsed,
        drafts: s.drafts,
        readState: s.readState,
        unreadCounts: s.unreadCounts,
        muted: s.muted,
      }),
    }
  )
);
