import { useMemo, useState } from "react";
import {
  Hash,
  Home,
  Activity,
  Bookmark,
  Plus,
  ChevronDown,
  Search,
  PanelLeftClose,
  PanelLeft,
  Settings2,
  PenSquare,
  VolumeX,
  Volume2,
} from "lucide-react";
import { useChat } from "../store";
import { workspace, users } from "../seed";
import { UserAvatar } from "./UserAvatar";
import { getUser, isSelf } from "../utils";
import type { Channel, DirectMessage } from "../types";

export function WorkspaceSidebar() {
  const conversations = useChat((s) => s.conversations);
  const activeId = useChat((s) => s.activeConversationId);
  const setActive = useChat((s) => s.setActiveConversation);
  const primaryView = useChat((s) => s.primaryView);
  const setPrimaryView = useChat((s) => s.setPrimaryView);
  const collapsed = useChat((s) => s.sidebarCollapsed);
  const toggleSidebar = useChat((s) => s.toggleSidebar);
  const setSearchOpen = useChat((s) => s.setSearchOpen);
  const setMenuOpen = useChat((s) => s.setMenuOpen);
  const unreadCounts = useChat((s) => s.unreadCounts);
  const muted = useChat((s) => s.muted);
  const createChannel = useChat((s) => s.createChannel);
  const toggleMute = (id: string) =>
    useChat.setState((s) => ({ muted: { ...s.muted, [id]: !s.muted[id] } }));

  const [channelsOpen, setChannelsOpen] = useState(true);
  const [dmsOpen, setDmsOpen] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const channels = useMemo(
    () => conversations.filter((c): c is Channel => c.kind === "channel"),
    [conversations]
  );
  const dms = useMemo(
    () => conversations.filter((c): c is DirectMessage => c.kind === "dm"),
    [conversations]
  );

  // group channels by section
  const sections = useMemo(() => {
    const map = new Map<string, Channel[]>();
    for (const c of channels) {
      const sec = c.section || "Channels";
      if (!map.has(sec)) map.set(sec, []);
      map.get(sec)!.push(c);
    }
    return Array.from(map.entries());
  }, [channels]);

  const totalUnread = Object.values(unreadCounts).reduce((a, b) => a + b, 0);

  if (collapsed) {
    return (
      <nav
        className="flex w-14 shrink-0 flex-col items-center gap-1 bg-ink-950 py-3 text-slate-300"
        aria-label="Workspace quick nav"
      >
        <button
          onClick={toggleSidebar}
          className="mb-2 rounded-lg p-2 hover:bg-ink-800"
          title="Expand sidebar"
          aria-label="Expand sidebar"
        >
          <PanelLeft size={20} />
        </button>
        <SidebarIcon icon={<Home size={20} />} label="Home" active={primaryView === "home"} onClick={() => setPrimaryView("home")} />
        <SidebarIcon icon={<Activity size={20} />} label="Activity" active={primaryView === "activity"} onClick={() => setPrimaryView("activity")} badge={totalUnread || undefined} />
        <SidebarIcon icon={<Bookmark size={20} />} label="Saved" active={primaryView === "saved"} onClick={() => setPrimaryView("saved")} />
        <SidebarIcon icon={<Search size={20} />} label="Search" onClick={() => setSearchOpen(true)} />
      </nav>
    );
  }

  return (
    <nav
      className="flex w-64 shrink-0 flex-col bg-ink-950 text-slate-300 md:w-72"
      aria-label="Workspace sidebar"
    >
      {/* workspace header */}
      <div className="flex items-center justify-between border-b border-ink-800 px-3 py-3">
        <button
          onClick={() => setMenuOpen(true)}
          className="flex min-w-0 items-center gap-2 rounded-lg px-1 py-1 hover:bg-ink-800"
        >
          <span
            className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold text-white"
            style={{ background: workspace.accent }}
          >
            WJ
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-white">{workspace.name}</span>
            <span className="block text-[11px] text-slate-400">demo workspace</span>
          </span>
        </button>
        <button
          onClick={toggleSidebar}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-ink-800 hover:text-white"
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
        >
          <PanelLeftClose size={18} />
        </button>
      </div>

      {/* primary nav */}
      <div className="flex flex-col gap-0.5 px-2 pt-2">
        <NavRow icon={<Home size={18} />} label="Home" active={primaryView === "home"} onClick={() => setPrimaryView("home")} />
        <NavRow
          icon={<Activity size={18} />}
          label="Activity"
          active={primaryView === "activity"}
          onClick={() => setPrimaryView("activity")}
          badge={totalUnread || undefined}
        />
        <NavRow icon={<Bookmark size={18} />} label="Saved" active={primaryView === "saved"} onClick={() => setPrimaryView("saved")} />
        <NavRow icon={<Search size={18} />} label="Search" onClick={() => setSearchOpen(true)} />
      </div>

      <div className="scroll-thin flex-1 overflow-y-auto px-2 py-2">
        {/* channels */}
        <SectionHeader
          label="Channels"
          open={channelsOpen}
          onToggle={() => setChannelsOpen((v) => !v)}
          action={
            <button
              onClick={() => setAdding((v) => !v)}
              className="rounded p-1 text-slate-400 hover:bg-ink-800 hover:text-white"
              title="Add channel"
              aria-label="Add channel"
            >
              <Plus size={15} />
            </button>
          }
        />
        {adding && (
          <div className="mb-2 rounded-lg bg-ink-900 p-2">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="channel-name"
              className="mb-1 w-full rounded bg-ink-800 px-2 py-1 text-sm text-white outline-none placeholder:text-slate-500"
            />
            <input
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="description (optional)"
              className="mb-1 w-full rounded bg-ink-800 px-2 py-1 text-sm text-white outline-none placeholder:text-slate-500"
            />
            <div className="flex gap-1">
              <button
                disabled={!newName.trim()}
                onClick={() => {
                  createChannel(newName, "Channels", newDesc);
                  setNewName("");
                  setNewDesc("");
                  setAdding(false);
                }}
                className="flex-1 rounded bg-moss px-2 py-1 text-sm font-medium text-ink-950 disabled:opacity-40"
              >
                Create
              </button>
              <button
                onClick={() => setAdding(false)}
                className="rounded px-2 py-1 text-sm text-slate-300 hover:bg-ink-800"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {channelsOpen &&
          sections.map(([section, list]) => (
            <div key={section} className="mb-1">
              <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {section}
              </div>
              {list.map((c) => (
                <ChannelRow
                  key={c.id}
                  channel={c}
                  active={primaryView === "home" && activeId === c.id}
                  unread={unreadCounts[c.id] || 0}
                  isMuted={!!muted[c.id]}
                  onOpen={() => setActive(c.id)}
                  onToggleMute={() => toggleMute(c.id)}
                />
              ))}
            </div>
          ))}

        {/* DMs */}
        <SectionHeader
          label="Direct messages"
          open={dmsOpen}
          onToggle={() => setDmsOpen((v) => !v)}
          action={
            <button
              className="rounded p-1 text-slate-400 hover:bg-ink-800 hover:text-white"
              title="New message"
              aria-label="New message"
            >
              <PenSquare size={15} />
            </button>
          }
        />
        {dmsOpen &&
          dms.map((dm) => {
            const u = getUser(dm.userId);
            return (
              <button
                key={dm.id}
                onClick={() => setActive(dm.id)}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-ink-800 ${
                  primaryView === "home" && activeId === dm.id ? "bg-ink-800 text-white" : "text-slate-300"
                }`}
              >
                <UserAvatar name={u.name} color={u.avatarColor} size={22} presence={u.presence} />
                <span className="flex-1 truncate">{u.name}</span>
                {unreadCounts[dm.id] ? (
                  <span className="rounded-full bg-clay px-1.5 text-[11px] font-semibold text-ink-950">
                    {unreadCounts[dm.id]}
                  </span>
                ) : null}
              </button>
            );
          })}
      </div>

      {/* self footer */}
      <SelfFooter onOpenMenu={() => setMenuOpen(true)} />
    </nav>
  );
}

function SelfFooter({ onOpenMenu }: { onOpenMenu: () => void }) {
  const me = users.find((u) => isSelf(u.id))!;
  return (
    <div className="flex items-center gap-2 border-t border-ink-800 px-3 py-2">
      <UserAvatar name={me.name} color={me.avatarColor} size={30} presence="online" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-white">{me.name}</div>
        <div className="truncate text-[11px] text-slate-400">{me.title}</div>
      </div>
      <button
        onClick={onOpenMenu}
        className="rounded-lg p-1.5 text-slate-400 hover:bg-ink-800 hover:text-white"
        title="Settings"
        aria-label="Settings"
      >
        <Settings2 size={17} />
      </button>
    </div>
  );
}

function NavRow({
  icon,
  label,
  active,
  onClick,
  badge,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-ink-800 ${
        active ? "bg-ink-800 font-medium text-white" : "text-slate-300"
      }`}
    >
      <span className={active ? "text-moss-soft" : "text-slate-400"}>{icon}</span>
      <span className="flex-1">{label}</span>
      {badge ? (
        <span className="rounded-full bg-clay px-1.5 text-[11px] font-semibold text-ink-950">{badge}</span>
      ) : null}
    </button>
  );
}

function SidebarIcon({
  icon,
  label,
  active,
  onClick,
  badge,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative rounded-lg p-2 hover:bg-ink-800 ${active ? "text-white" : "text-slate-400"}`}
      title={label}
      aria-label={label}
    >
      {icon}
      {badge ? (
        <span className="absolute -right-0.5 -top-0.5 rounded-full bg-clay px-1 text-[10px] font-semibold text-ink-950">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function SectionHeader({
  label,
  open,
  onToggle,
  action,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-2 py-1">
      <button onClick={onToggle} className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-300">
        <ChevronDown size={13} className={`transition-transform ${open ? "" : "-rotate-90"}`} />
        {label}
      </button>
      {action}
    </div>
  );
}

function ChannelRow({
  channel,
  active,
  unread,
  isMuted,
  onOpen,
  onToggleMute,
}: {
  channel: Channel;
  active: boolean;
  unread: number;
  isMuted: boolean;
  onOpen: () => void;
  onToggleMute: () => void;
}) {
  return (
    <div
      className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm hover:bg-ink-800 ${
        active ? "bg-ink-800 text-white" : unread ? "text-white" : "text-slate-300"
      }`}
    >
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
        <Hash size={16} className={unread ? "text-moss-soft" : "text-slate-500"} />
        <span className={`flex-1 truncate ${unread ? "font-semibold" : ""}`}>{channel.name}</span>
      </button>
      <button
        onClick={onToggleMute}
        className="rounded p-1 text-slate-500 opacity-0 hover:bg-ink-700 hover:text-white group-hover:opacity-100"
        title={isMuted ? "Unmute" : "Mute"}
        aria-label={isMuted ? "Unmute channel" : "Mute channel"}
      >
        {isMuted ? <VolumeX size={13} /> : <Volume2 size={13} />}
      </button>
      {unread ? (
        <span className="rounded-full bg-clay px-1.5 text-[11px] font-semibold text-ink-950">{unread}</span>
      ) : null}
    </div>
  );
}
