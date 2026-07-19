import { useMemo, useState } from "react";
import { Search, X, Hash, MessageSquare, Users as UsersIcon, FileText } from "lucide-react";
import { useChat } from "../store";
import { getUser, highlight, formatTime } from "../utils";
import { workspace, users } from "../seed";
import type { Conversation, Message, Attachment } from "../types";

type Tab = "all" | "messages" | "people" | "channels" | "files";

export function SearchDialog() {
  const setSearchOpen = useChat((s) => s.setSearchOpen);
  const messages = useChat((s) => s.messages);
  const conversations = useChat((s) => s.conversations);
  const setActive = useChat((s) => s.setActiveConversation);

  const [q, setQ] = useState("");
  const [tab, setTab] = useState<Tab>("all");

  const query = q.trim().toLowerCase();

  const msgResults = useMemo(() => {
    if (!query) return [];
    return messages
      .filter((m) => m.text.toLowerCase().includes(query))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 30);
  }, [messages, query]);

  const peopleResults = useMemo(() => {
    if (!query) return [];
    return users.filter(
      (u) => u.name.toLowerCase().includes(query) || u.handle.toLowerCase().includes(query)
    );
  }, [users, query]);

  const channelResults = useMemo(() => {
    if (!query) return [];
    return conversations.filter(
      (c): c is import("../types").Channel => c.kind === "channel" && c.name.toLowerCase().includes(query)
    );
  }, [conversations, query]);

  const fileResults = useMemo(() => {
    if (!query) return [];
    const out: { att: Attachment; msg: Message }[] = [];
    for (const m of messages) {
      for (const a of m.attachments || []) {
        if (a.name.toLowerCase().includes(query)) out.push({ att: a, msg: m });
      }
    }
    return out.slice(0, 20);
  }, [messages, query]);

  const openAndClose = (id: string) => {
    setActive(id);
    setSearchOpen(false);
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center bg-black/40 p-4 pt-[8vh] animate-fade-in"
      onClick={() => setSearchOpen(false)}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-surface-raised shadow-pop dark:border-ink-700 dark:bg-ink-900"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Search"
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3 dark:border-ink-800">
          <Search size={18} className="text-slate-400" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setSearchOpen(false)}
            placeholder={`Search ${workspace.name}…`}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
          />
          <button
            onClick={() => setSearchOpen(false)}
            className="rounded-lg p-1 text-slate-400 hover:bg-surface-sunken dark:hover:bg-ink-800"
            aria-label="Close search"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex gap-1 border-b border-line px-3 py-2 text-xs dark:border-ink-800">
          {(["all", "messages", "people", "channels", "files"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-full px-3 py-1 font-medium capitalize ${
                tab === t ? "bg-moss/15 text-moss" : "text-slate-500 hover:bg-surface-sunken dark:hover:bg-ink-800"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="scroll-thin max-h-[55vh] overflow-y-auto p-2">
          {!query && (
            <div className="px-3 py-8 text-center text-sm text-slate-400">
              Type to search messages, people, channels, and files.
            </div>
          )}

          {(tab === "all" || tab === "messages") && msgResults.length > 0 && (
            <Group label={`Messages (${msgResults.length})`} icon={<MessageSquare size={14} />}>
              {msgResults.map((m) => (
                <ResultRow
                  key={m.id}
                  icon={<Hash size={14} className="text-moss" />}
                  title={convLabel(conversations, m.conversationId)}
                  subtitle={`${getUser(m.senderId).name} · ${formatTime(m.createdAt)}`}
                  bodyHtml={highlight(m.text, q.trim())}
                  onClick={() => openAndClose(m.conversationId)}
                />
              ))}
            </Group>
          )}

          {(tab === "all" || tab === "people") && peopleResults.length > 0 && (
            <Group label={`People (${peopleResults.length})`} icon={<UsersIcon size={14} />}>
              {peopleResults.map((u) => (
                <ResultRow
                  key={u.id}
                  icon={
                    <span
                      className="flex h-5 w-5 items-center justify-center rounded-md text-[10px] font-semibold text-white"
                      style={{ background: u.avatarColor }}
                    >
                      {u.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("")}
                    </span>
                  }
                  title={u.name}
                  subtitle={`@${u.handle} · ${u.title || ""}`}
                  onClick={() => setSearchOpen(false)}
                />
              ))}
            </Group>
          )}

          {(tab === "all" || tab === "channels") && channelResults.length > 0 && (
            <Group label={`Channels (${channelResults.length})`} icon={<Hash size={14} />}>
              {channelResults.map((c) => (
                <ResultRow
                  key={c.id}
                  icon={<Hash size={14} className="text-moss" />}
                  title={`#${c.name}`}
                  subtitle={c.description || ""}
                  onClick={() => openAndClose(c.id)}
                />
              ))}
            </Group>
          )}

          {(tab === "all" || tab === "files") && fileResults.length > 0 && (
            <Group label={`Files (${fileResults.length})`} icon={<FileText size={14} />}>
              {fileResults.map((f, i) => (
                <ResultRow
                  key={i}
                  icon={<FileText size={14} className="text-moss" />}
                  title={f.att.name}
                  subtitle={convLabel(conversations, f.msg.conversationId)}
                  onClick={() => openAndClose(f.msg.conversationId)}
                />
              ))}
            </Group>
          )}

          {query &&
            tab !== "people" &&
            msgResults.length === 0 &&
            channelResults.length === 0 &&
            fileResults.length === 0 && (
              <div className="px-3 py-8 text-center text-sm text-slate-400">No matches for “{q}”.</div>
            )}
        </div>
      </div>
    </div>
  );
}

function Group({
  label,
  icon,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-2">
      <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {icon}
        {label}
      </div>
      {children}
    </div>
  );
}

function ResultRow({
  icon,
  title,
  subtitle,
  bodyHtml,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  bodyHtml?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-sunken dark:hover:bg-ink-800"
    >
      <span className="mt-0.5 text-slate-400">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-100">{title}</span>
        {subtitle && <span className="block truncate text-xs text-slate-400">{subtitle}</span>}
        {bodyHtml && (
          <span
            className="mt-0.5 block line-clamp-2 text-xs text-slate-500 dark:text-slate-400"
            dangerouslySetInnerHTML={{ __html: bodyHtml }}
          />
        )}
      </span>
    </button>
  );
}

function convLabel(conversations: Conversation[], id: string): string {
  const c = conversations.find((x) => x.id === id);
  if (!c) return "conversation";
  if (c.kind === "dm") return getUser(c.userId).name;
  return `#${c.name}`;
}
