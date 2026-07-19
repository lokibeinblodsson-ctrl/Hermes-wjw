import { Hash, Search, Info, ArrowLeft, Users, Bell, BellOff, Star, Sparkles, LayoutGrid, Calendar, Brain, FileText } from "lucide-react";
import { useChat, HERMES_CHANNEL_ID } from "../store";
import { getUser } from "../utils";
import type { Conversation } from "../types";

// Buttons that link a conversation to the other parts of the web app.
const CROSS_LINKS = [
  { to: "/", label: "Board", icon: LayoutGrid },
  { to: "/calendar", label: "Calendar", icon: Calendar },
  { to: "/memory", label: "Memory", icon: Brain },
  { to: "/docs", label: "Docs", icon: FileText },
];

export function ConversationHeader({ conv }: { conv: Conversation }) {
  const setSearchOpen = useChat((s) => s.setSearchOpen);
  const muted = useChat((s) => s.muted[conv.id]);
  const toggleMute = () =>
    useChat.setState((s) => ({ muted: { ...s.muted, [conv.id]: !s.muted[conv.id] } }));
  const unread = useChat((s) => s.unreadCounts[conv.id] || 0);

  const isHermes = conv.id === HERMES_CHANNEL_ID;
  const isDm = conv.kind === "dm";
  const dmUser = isDm ? getUser(conv.userId) : null;
  const title = isDm ? dmUser!.name : conv.name;
  const subtitle = isDm
    ? `${dmUser!.title} · ${dmUser!.presence}`
    : conv.description || `${conv.memberCount} members`;

  return (
    <header className="flex items-center gap-2 border-b border-line bg-surface-raised px-3 py-2.5 dark:border-ink-800 dark:bg-ink-900 md:px-4">
      <button
        onClick={() => useChat.getState().toggleSidebar()}
        className="rounded-lg p-1.5 text-slate-500 hover:bg-surface-sunken dark:hover:bg-ink-800 md:hidden"
        title="Back to conversations"
        aria-label="Back to conversations"
      >
        <ArrowLeft size={20} />
      </button>

      {isHermes ? (
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-moss/20 text-moss">
          <Sparkles size={18} />
        </span>
      ) : !isDm ? (
        <Hash size={20} className="text-moss" />
      ) : null}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h1 className="truncate text-base font-semibold text-slate-900 dark:text-white">
            {isHermes ? "Hermes" : title}
          </h1>
          {!isDm && unread ? (
            <span className="rounded-full bg-clay px-1.5 text-[11px] font-semibold text-ink-950">{unread}</span>
          ) : null}
        </div>
        <p className="truncate text-xs text-slate-500 dark:text-slate-400">
          {isHermes ? "Ask questions or request actions — linked to the rest of the app." : subtitle}
        </p>
      </div>

      {/* cross-links to other areas of the web app */}
      <div className="hidden items-center gap-1 lg:flex">
        {CROSS_LINKS.map((l) => {
          const Icon = l.icon;
          return (
            <a
              key={l.to}
              href={l.to}
              className="rounded-lg p-2 text-slate-500 hover:bg-surface-sunken dark:hover:bg-ink-800"
              title={`Open ${l.label}`}
              aria-label={l.label}
            >
              <Icon size={18} />
            </a>
          );
        })}
      </div>

      <div className="flex items-center gap-1">
        {!isDm && !isHermes && (
          <button
            onClick={toggleMute}
            className="rounded-lg p-2 text-slate-500 hover:bg-surface-sunken dark:hover:bg-ink-800"
            title={muted ? "Unmute" : "Mute"}
            aria-label={muted ? "Unmute" : "Mute"}
          >
            {muted ? <BellOff size={18} /> : <Bell size={18} />}
          </button>
        )}
        {!isDm && !isHermes && (
          <span className="hidden items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-500 sm:flex">
            <Users size={14} /> {conv.memberCount}
          </span>
        )}
        <button
          onClick={() => setSearchOpen(true)}
          className="rounded-lg p-2 text-slate-500 hover:bg-surface-sunken dark:hover:bg-ink-800"
          title="Search in conversation"
          aria-label="Search"
        >
          <Search size={18} />
        </button>
        <button
          className="rounded-lg p-2 text-slate-500 hover:bg-surface-sunken dark:hover:bg-ink-800"
          title="Conversation details"
          aria-label="Conversation details"
        >
          <Info size={18} />
        </button>
      </div>
    </header>
  );
}
