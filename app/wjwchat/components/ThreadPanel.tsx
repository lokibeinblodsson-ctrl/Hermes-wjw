import { useEffect, useRef, useState } from "react";
import { X, MessageSquare, Users } from "lucide-react";
import { useChat } from "../store";
import { getUser, formatTime, formatFull, renderText } from "../utils";

export function ThreadPanel() {
  const messageId = useChat((s) => s.threadPanelMessageId)!;
  const messages = useChat((s) => s.messages);
  const threadReplies = useChat((s) => s.threadReplies);
  const setThreadPanel = useChat((s) => s.setThreadPanel);
  const sendThreadReply = useChat((s) => s.sendThreadReply);
  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const root = messages.find((m) => m.id === messageId);
  const replies = threadReplies[messageId] || [];
  const participants = root?.threadParticipants || [];

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [replies.length]);

  if (!root) return null;
  const sender = getUser(root.senderId);

  const send = () => {
    const t = text.trim();
    if (!t) return;
    sendThreadReply(messageId, t);
    setText("");
  };

  return (
    <aside
      className="flex w-full shrink-0 flex-col border-l border-line bg-surface-raised dark:border-ink-800 dark:bg-ink-900 md:w-96 animate-slide-in-right"
      aria-label="Thread"
    >
      <div className="flex items-center justify-between border-b border-line px-4 py-3 dark:border-ink-800">
        <div className="flex items-center gap-2">
          <MessageSquare size={18} className="text-moss" />
          <div>
            <div className="text-sm font-semibold text-slate-900 dark:text-white">Thread</div>
            <div className="text-[11px] text-slate-400">
              {replies.length} {replies.length === 1 ? "reply" : "replies"}
            </div>
          </div>
        </div>
        <button
          onClick={() => setThreadPanel(null)}
          className="rounded-lg p-1.5 text-slate-500 hover:bg-surface-sunken dark:hover:bg-ink-800"
          title="Close thread"
          aria-label="Close thread"
        >
          <X size={18} />
        </button>
      </div>

      <div ref={scrollRef} className="scroll-thin flex-1 overflow-y-auto px-3 py-3">
        {/* root message */}
        <div className="flex gap-2.5 rounded-lg bg-surface-sunken/60 p-2 dark:bg-ink-850">
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold text-white"
            style={{ background: sender.avatarColor }}
          >
            {sender.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("")}
          </span>
          <div className="min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold text-slate-900 dark:text-white">{sender.name}</span>
              <span className="text-[11px] text-slate-400" title={formatFull(root.createdAt)}>
                {formatTime(root.createdAt)}
              </span>
            </div>
            <div
              className="text-sm leading-relaxed text-slate-800 dark:text-slate-200"
              dangerouslySetInnerHTML={{ __html: renderText(root.text) }}
            />
          </div>
        </div>

        <div className="my-2 flex items-center gap-2 pl-1 text-[11px] text-slate-400">
          <div className="h-px flex-1 bg-line dark:bg-ink-800" />
          {replies.length > 0 ? `${replies.length} replies` : "No replies yet"}
          <div className="h-px flex-1 bg-line dark:bg-ink-800" />
        </div>

        {replies.map((r) => {
          const u = getUser(r.senderId);
          return (
            <div key={r.id} className="flex gap-2.5 py-1.5">
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold text-white"
                style={{ background: u.avatarColor }}
              >
                {u.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("")}
              </span>
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold text-slate-900 dark:text-white">{u.name}</span>
                  <span className="text-[11px] text-slate-400" title={formatFull(r.createdAt)}>
                    {formatTime(r.createdAt)}
                  </span>
                </div>
                <div
                  className="text-sm leading-relaxed text-slate-800 dark:text-slate-200"
                  dangerouslySetInnerHTML={{ __html: renderText(r.text) }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {participants.length > 0 && (
        <div className="flex items-center gap-1.5 px-4 py-1 text-[11px] text-slate-400">
          <Users size={12} />
          <span>{participants.length} participant{participants.length === 1 ? "" : "s"}</span>
        </div>
      )}

      <div className="border-t border-line px-3 py-2.5 dark:border-ink-800">
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder="Reply in thread…"
            className="composer-input flex-1 resize-none rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-moss/50 dark:border-ink-700 dark:bg-ink-850"
          />
          <button
            onClick={send}
            disabled={!text.trim()}
            className="rounded-xl bg-moss px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
    </aside>
  );
}
