import type {
  User,
  Conversation,
  Message,
  Notification,
  Workspace,
} from "./types";

// ── Workspace ───────────────────────────────────────────────────────────────
export const workspace: Workspace = {
  id: "wsp_wjw",
  name: "Wild Jazmine Wellness",
  accent: "#6f8f7d",
};

// ── Current (self) user ──────────────────────────────────────────────────────
export const CURRENT_USER_ID = "usr_you";

// ── People ───────────────────────────────────────────────────────────────────
export const users: User[] = [
  { id: CURRENT_USER_ID, name: "You", handle: "you", avatarColor: "#6f8f7d", presence: "online", title: "Practitioner" },
  { id: "usr_celina", name: "Celina Hart", handle: "celina", avatarColor: "#cf9f8f", presence: "online", title: "Founder & Therapist" },
  { id: "usr_jay", name: "Jay Okafor", handle: "jay", avatarColor: "#7c8fc4", presence: "online", title: "Content Lead" },
  { id: "usr_mira", name: "Mira Lindqvist", handle: "mira", avatarColor: "#b58ab0", presence: "away", title: "EFT Practitioner" },
  { id: "usr_theo", name: "Theo Brandt", handle: "theo", avatarColor: "#c4a86f", presence: "offline", title: "Ops & Systems" },
  { id: "usr_nova", name: "Nova Reyes", handle: "nova", avatarColor: "#6fb0a0", presence: "online", title: "Community Manager" },
  { id: "usr_sam", name: "Sam Whitfield", handle: "sam", avatarColor: "#9a8fb0", presence: "offline", title: "Client Care" },
];

// ── Conversations ────────────────────────────────────────────────────────────
export const conversations: Conversation[] = [
  // Channels (grouped by section)
  { id: "chn_announce", kind: "channel", name: "announcements", section: "Studio", description: "Studio-wide updates from the team.", memberCount: 42 },
  { id: "chn_general", kind: "channel", name: "general", section: "Studio", description: "Everyday chatter and check-ins.", memberCount: 38 },
  { id: "chn_clinical", kind: "channel", name: "clinical-team", section: "Teams", description: "Practitioner coordination. Client-safe only.", memberCount: 9 },
  { id: "chn_content", kind: "channel", name: "content-studio", section: "Teams", description: "Editorial calendar, drafts, and reviews.", memberCount: 7 },
  { id: "chn_social", kind: "channel", name: "social-listening", section: "Teams", description: "What clients are saying out there.", memberCount: 6 },
  { id: "chn_launch", kind: "channel", name: "launch-efct-course", section: "Projects", description: "Q3 EFCT Practitioner course launch.", memberCount: 11 },
  { id: "chn_brand", kind: "channel", name: "brand-refresh", section: "Projects", description: "Visual + voice evolution.", memberCount: 5 },
  { id: "chn_random", kind: "channel", name: "off-topic", section: "Projects", description: "Tea recommendations and dog photos.", memberCount: 40, muted: true },
  // Direct messages
  { id: "dm_celina", kind: "dm", userId: "usr_celina" },
  { id: "dm_jay", kind: "dm", userId: "usr_jay" },
  { id: "dm_mira", kind: "dm", userId: "usr_mira" },
  { id: "dm_nova", kind: "dm", userId: "usr_nova" },
];

// stable iso timestamps relative to "now" for realistic ordering
const now = Date.now();
const hrs = (h: number) => new Date(now - h * 3_600_000).toISOString();
const days = (d: number) => new Date(now - d * 86_400_000).toISOString();

// ── Messages ─────────────────────────────────────────────────────────────────
export const seedMessages: Message[] = [
  // announcements
  msg("m_ann1", "chn_announce", "usr_celina", "Welcome to the Wild Jazmine Wellness workspace 👋 We'll use this space for day-to-day coordination.", hrs(28), { isSaved: true }),
  msg("m_ann2", "chn_announce", "usr_celina", "Reminder: the new client intake form goes live Monday. @jay please double-check the copy on the confirmation email.", hrs(20)),
  msg("m_ann3", "chn_announce", "usr_theo", "Heads up — the booking calendar will have ~10 min downtime tonight at 9pm for a migration. Nothing client-facing.", hrs(6)),

  // general
  msg("m_gen1", "chn_general", "usr_jay", "Morning all ☀️ Hope everyone's week is gentle.", hrs(26)),
  msg("m_gen2", "chn_general", "usr_nova", "It is! Slept with the window open for the first time this year.", hrs(25)),
  msg("m_gen3", "chn_general", "usr_mira", "Anyone else finding clients are arriving more regulated lately? Feels like the group work is landing.", hrs(4), { reactions: [rx("💛", ["usr_celina", "usr_jay", "usr_nova"]), rx("🌿", ["usr_theo"])] }),
  msg("m_gen4", "chn_general", "usr_celina", "Yes — three unsolicited 'I finally slept through the night' messages this week @mira. The container we're holding is working.", hrs(3), { isSaved: true }),

  // clinical-team
  msg("m_cl1", "chn_clinical", "usr_mira", "Sharing a framing I used yesterday for a client stuck in a shame loop: 'the feeling is data, not a verdict.' Landed really well.", hrs(22)),
  msg("m_cl2", "chn_clinical", "usr_celina", "Love that. Adding to the shared language doc. @mira can you drop it in #content-studio so Jay can thread it into the next post?", hrs(21)),
  msg("m_cl3", "chn_clinical", "usr_mira", "On it 👍", hrs(21)),
  msg("m_cl4", "chn_clinical", "usr_theo", "Note: keep client identifiers out of threads here per the agreement. Use first names only.", days(2), { reactions: [rx("✅", ["usr_celina", "usr_mira", "usr_jay"])] }),

  // content-studio
  msg("m_co1", "chn_content", "usr_jay", "Draft for the 'EFT for sleep' carousel is in. Hook is: 'You can't think your way out of a nervous system that thinks it's unsafe.'", hrs(19)),
  msg("m_co2", "chn_content", "usr_mira", "That's a great hook. Maybe soften 'unsafe' to 'on alert'? 'Unsafe' can spike the exact thing we're calming.", hrs(18), { reactions: [rx("💡", ["usr_jay", "usr_celina"])] }),
  msg("m_co3", "chn_content", "usr_jay", "Good call — 'on alert' it is. Updating now.", hrs(18)),
  msg("m_co4", "chn_content", "usr_celina", "Attaching the brand reference for the gradient treatment on slide 3:", hrs(9), {
    attachments: [att("at_1", "image", "sleep-carousel-ref.png", undefined, ["#6f8f7d", "#cf9f8f"])],
  }),
  msg("m_co5", "chn_content", "usr_jay", "Perfect, matches the new palette. Shipping to review.", hrs(8), { replyCount: 2, threadParticipants: ["usr_jay", "usr_celina"] }),

  // social-listening
  msg("m_so1", "chn_social", "usr_nova", "Someone in a parenting group asked if tapping helps with 'Sunday scaries' before the work week. Big opportunity.", hrs(14)),
  msg("m_so2", "chn_social", "usr_jay", "Replying with the free mini-script link. @nova can you track if it converts?", hrs(13)),
  msg("m_so3", "chn_social", "usr_nova", "Will do. So far 4 saves and 1 booked call from that thread.", hrs(12), { reactions: [rx("🚀", ["usr_jay", "usr_celina", "usr_mira"])] }),

  // launch-efct-course
  msg("m_la1", "chn_launch", "usr_celina", "EFCT Practitioner course: we're targeting soft launch Aug 14, public Aug 21. Module 3 still needs a recording.", hrs(30)),
  msg("m_la2", "chn_launch", "usr_mira", "Recording slot booked Thursday 2pm. Need a quiet room — @theo the back office free then?", hrs(29)),
  msg("m_la3", "usr_theo", "chn_launch", "Back office is yours Thursday. I'll move my sync out.", hrs(29), { reactions: [rx("🙏", ["usr_mira"])] }),
  msg("m_la4", "chn_launch", "usr_jay", "Pricing ladder proposal:\n- Founding cohort: $297 (20 seats)\n- Standard: $447\n- Team license: $1,200\nThoughts?", hrs(10)),
  msg("m_la5", "chn_launch", "usr_celina", "Love the founding tier. Let's cap at 15 to keep it intimate.", hrs(9)),

  // brand-refresh
  msg("m_br1", "chn_brand", "usr_jay", "New direction: warm, low-saturation, 'calm authority.' Moving away from bright clinical blue/green.", hrs(40)),
  msg("m_br2", "usr_celina", "brand-refresh", "Yes — softer moss + clay. Easier on the eyes for people already dysregulated.", hrs(39), { isSaved: true }),

  // off-topic (muted)
  msg("m_of1", "chn_random", "usr_nova", "Best chamomile + lavender blend I've tried: equal parts, steep 7 min. 🍵", days(1)),
  msg("m_of2", "chn_random", "usr_theo", "My corgi tried to attend a client call again. Webinar-bombing era.", days(1), { reactions: [rx("😂", ["usr_nova", "usr_jay", "usr_celina"])] }),

  // DMs
  msg("m_dm1", "dm_celina", "usr_celina", "Hey — do you have 15 min later to look at the course outline before I send to the designer?", hrs(5)),
  msg("m_dm2", "dm_celina", CURRENT_USER_ID, "Yes! 3pm works. I'll bring notes on the nervous-system framing.", hrs(5)),
  msg("m_dm3", "dm_celina", "usr_celina", "Perfect. Also — thank you for holding the team so well this month. 💛", hrs(4), { reactions: [rx("💛", [CURRENT_USER_ID])] }),
  msg("m_dm4", "dm_jay", "usr_jay", "Quick q: is the sleep carousel still on for Thursday's schedule or did we slip it?", hrs(7)),
  msg("m_dm5", "dm_jay", CURRENT_USER_ID, "Slipped to Friday — waiting on the voiceover. I'll ping you when it's locked.", hrs(7)),
  msg("m_dm6", "dm_mira", "usr_mira", "Sharing a client win (anonymized): 6 weeks of tapping and she cancelled her first panic-attack ER visit. The work matters. 🌿", hrs(16), { isSaved: true }),
  msg("m_dm7", "dm_mira", CURRENT_USER_ID, "That's beautiful, Mira. Thank you for sharing.", hrs(15), { reactions: [rx("🌿", ["usr_mira"])] }),
  msg("m_dm8", "dm_nova", "usr_nova", "The community call topic poll is live — 62 responses already. 'Boundaries' is winning.", hrs(11)),
];

// thread replies for the content-studio carousel message (m_co5)
export const seedThreadReplies: Record<string, import("./types").ThreadReply[]> = {
  m_co5: [
    { id: "tr_1", senderId: "usr_celina", text: "Slide 3 gradient is gorgeous. Can we reuse it for the course hero?", createdAt: hrs(8) },
    { id: "tr_2", senderId: "usr_jay", text: "Yes — exported the swatch pair to the brand kit.", createdAt: hrs(7) },
  ],
};

// ── Notifications (activity) ─────────────────────────────────────────────────
export const seedNotifications: Notification[] = [
  { id: "n_1", kind: "mention", conversationId: "chn_announce", messageId: "m_ann2", actorId: "usr_celina", text: "mentioned you in #announcements", createdAt: hrs(20) },
  { id: "n_2", kind: "thread_reply", conversationId: "chn_content", messageId: "m_co5", actorId: "usr_celina", text: "replied in a thread you're in", createdAt: hrs(8) },
  { id: "n_3", kind: "reaction", conversationId: "chn_general", messageId: "m_gen3", actorId: "usr_celina", text: "reacted 💛 to your message", createdAt: hrs(4) },
  { id: "n_4", kind: "mention", conversationId: "chn_clinical", messageId: "m_cl2", actorId: "usr_celina", text: "mentioned you in #clinical-team", createdAt: hrs(21) },
];

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
