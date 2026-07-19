import { useMemo } from "react";
import { Activity, AtSign, MessageSquare, Smile, Bell, Hash } from "lucide-react";
import { useChat } from "../store";
import { getUser, formatTime } from "../utils";
import { workspace } from "../seed";

export function ActivityFeed() {
  const notifications = useChat((s) => s.notifications);
  const conversations = useChat((s) => s.conversations);
  const setActive = useChat((s) => s.setActiveConversation);
  const setPrimaryView = useChat((s) => s.setPrimaryView);
  const unreadCounts = useChat((s) => s.unreadCounts);

  // merge live unread into activity (mentions + unread channels)
  const items = useMemo(() => {
    const list: { key: string; icon: React.ReactNode; text: string; sub: string; convId: string }[] = [];
    for (const n of notifications) {
      const actor = getUser(n.actorId);
      const icon =
        n.kind === "mention" ? <AtSign size={15} /> : n.kind === "thread_reply" ? <MessageSquare size={15} /> : <Smile size={15} />;
      list.push({
        key: n.id,
        icon,
        text: `${actor.name} ${n.text}`,
        sub: formatTime(n.createdAt),
        convId: n.conversationId,
      });
    }
    return list;
  }, [notifications]);

  const totalUnread = Object.values(unreadCounts).reduce((a, b) => a + b, 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-line bg-surface-raised px-4 py-3 dark:border-ink-800 dark:bg-ink-900">
        <Activity size={18} className="text-moss" />
        <h1 className="text-base font-semibold text-slate-900 dark:text-white">Activity</h1>
        {totalUnread > 0 && (
          <span className="rounded-full bg-clay px-1.5 text-[11px] font-semibold text-ink-950">{totalUnread}</span>
        )}
      </header>

      <div className="scroll-thin flex-1 overflow-y-auto px-3 py-3">
        <div className="mb-3 rounded-xl bg-surface-sunken px-3 py-2 text-xs text-slate-500 dark:bg-ink-850">
          Mentions, thread replies, and reactions to your messages appear here. {totalUnread} unread conversation
          {totalUnread === 1 ? "" : "s"} across {workspace.name}.
        </div>

        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-slate-400">
            <Bell size={28} />
            <p className="text-sm">You're all caught up. 🌿</p>
          </div>
        ) : (
          <ul className="space-y-1">
            {items.map((it) => {
              const conv = conversations.find((c) => c.id === it.convId);
              const label = conv?.kind === "dm" ? getUser(conv.userId).name : conv ? `#${conv.name}` : "";
              return (
                <li key={it.key}>
                  <button
                    onClick={() => {
                      setActive(it.convId);
                      setPrimaryView("home");
                    }}
                    className="flex w-full items-center gap-3 rounded-xl border border-transparent px-3 py-2 text-left hover:border-line hover:bg-surface-sunken dark:hover:border-ink-700 dark:hover:bg-ink-850"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-moss/15 text-moss">
                      {it.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-slate-700 dark:text-slate-200">{it.text}</span>
                      <span className="flex items-center gap-1 text-xs text-slate-400">
                        <Hash size={11} /> {label} · {it.sub}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
