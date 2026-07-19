import { useMemo } from "react";
import { Bookmark, Hash } from "lucide-react";
import { useChat } from "../store";
import { getUser, formatTime, renderText } from "../utils";
import type { Conversation } from "../types";

export function SavedView() {
  const messages = useChat((s) => s.messages);
  const conversations = useChat((s) => s.conversations);

  const saved = useMemo(
    () =>
      messages
        .filter((m) => m.isSaved)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [messages]
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-line bg-surface-raised px-4 py-3 dark:border-ink-800 dark:bg-ink-900">
        <Bookmark size={18} className="text-moss" />
        <h1 className="text-base font-semibold text-slate-900 dark:text-white">Saved</h1>
        <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs text-slate-500 dark:bg-ink-800">
          {saved.length}
        </span>
      </header>

      <div className="scroll-thin flex-1 overflow-y-auto px-2 py-3 md:px-4">
        {saved.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-slate-400">
            <Bookmark size={28} />
            <p className="text-sm">No saved messages yet. Hover a message and tap the bookmark to save it.</p>
          </div>
        ) : (
          <div className="space-y-1">
            {saved.map((m) => {
              const conv = conversations.find((c) => c.id === m.conversationId) as Conversation | undefined;
              const label =
                conv?.kind === "dm" ? getUser(conv.userId).name : conv ? `#${conv.name}` : "";
              return (
                <div key={m.id} className="rounded-lg">
                  <div className="mb-0.5 flex items-center gap-1 px-2 text-[11px] text-slate-400">
                    <Hash size={11} /> {label} · {getUser(m.senderId).name} · {formatTime(m.createdAt)}
                  </div>
                  <div
                    className="rounded-lg px-2 text-sm leading-relaxed text-slate-800 line-clamp-3 dark:text-slate-200"
                    dangerouslySetInnerHTML={{ __html: renderText(m.text) }}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
