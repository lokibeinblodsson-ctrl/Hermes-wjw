import { useState, useRef, useEffect } from "react";
import { Smile, Paperclip, AtSign, Send, X, Sparkles } from "lucide-react";
import { useChat, HERMES_CHANNEL_ID } from "../store";
import { users } from "../seed";
import type { Conversation } from "../types";

const EMOJIS = ["👍", "💛", "🌿", "🎉", "🙏", "😂", "🔥", "✨", "💡", "🤝"];

export function MessageComposer({
  conv,
  placeholder,
}: {
  conv: Conversation;
  placeholder: string;
}) {
  const draft = useChat((s) => s.drafts[conv.id] || "");
  const setDraft = useChat((s) => s.setDraft);
  const sendMessage = useChat((s) => s.sendMessage);
  const sendHermesMessage = useChat((s) => s.sendHermesMessage);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // auto-grow textarea
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }, [draft]);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    if (conv.id === HERMES_CHANNEL_ID) {
      sendHermesMessage(text);
    } else {
      sendMessage(conv.id, text);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const addEmoji = (e: string) => {
    setDraft(conv.id, draft + e);
    setPickerOpen(false);
    taRef.current?.focus();
  };

  const insertMention = (handle: string) => {
    // replace trailing partial "@" if present, else append
    const next = /@[\w]*$/.test(draft)
      ? draft.replace(/@[\w]*$/, `@${handle} `)
      : draft + `@${handle} `;
    setDraft(conv.id, next);
    setMentionOpen(false);
    taRef.current?.focus();
  };

  return (
    <div className="border-t border-line bg-surface-raised px-3 py-2.5 dark:border-ink-800 dark:bg-ink-900 md:px-4">
      <div className="flex items-end gap-2">
        <div className="flex items-center gap-0.5 text-slate-500">
          <button
            onClick={() => setPickerOpen((v) => !v)}
            className="rounded-lg p-2 hover:bg-surface-sunken dark:hover:bg-ink-800"
            title="Emoji"
            aria-label="Emoji"
          >
            <Smile size={18} />
          </button>
          <button
            className="rounded-lg p-2 hover:bg-surface-sunken dark:hover:bg-ink-800"
            title="Attach (demo)"
            aria-label="Attach"
          >
            <Paperclip size={18} />
          </button>
          <button
            onClick={() => setMentionOpen((v) => !v)}
            className="rounded-lg p-2 hover:bg-surface-sunken dark:hover:bg-ink-800"
            title="Mention someone"
            aria-label="Mention"
          >
            <AtSign size={18} />
          </button>
        </div>

        <div className="relative flex-1">
          <textarea
            ref={taRef}
            value={draft}
            onChange={(e) => setDraft(conv.id, e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={placeholder}
            className="composer-input w-full resize-none rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-moss/50 dark:border-ink-700 dark:bg-ink-850"
          />

          {pickerOpen && (
            <div className="absolute bottom-12 left-0 z-20 flex flex-wrap gap-1 rounded-xl border border-line bg-surface-raised p-2 shadow-pop animate-pop-in dark:border-ink-700 dark:bg-ink-850">
              {EMOJIS.map((e) => (
                <button key={e} onClick={() => addEmoji(e)} className="rounded p-1 text-xl hover:bg-surface-sunken dark:hover:bg-ink-800">
                  {e}
                </button>
              ))}
            </div>
          )}

          {mentionOpen && (
            <div className="absolute bottom-12 left-0 z-20 w-56 rounded-xl border border-line bg-surface-raised p-1 shadow-pop animate-pop-in dark:border-ink-700 dark:bg-ink-850">
              <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Mention
              </div>
              {users
                .filter((u) => u.id !== "usr_hermes" && u.id !== useChat.getState().currentUserId)
                .map((u) => (
                  <button
                    key={u.id}
                    onClick={() => insertMention(u.handle)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-sunken dark:hover:bg-ink-800"
                  >
                    <span
                      className="flex h-6 w-6 items-center justify-center rounded-md text-[11px] font-semibold text-white"
                      style={{ background: u.avatarColor }}
                    >
                      {u.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("")}
                    </span>
                    <span className="flex-1 truncate">
                      <span className="font-medium text-slate-800 dark:text-slate-100">{u.name}</span>
                      <span className="ml-1 text-xs text-slate-400">@{u.handle}</span>
                    </span>
                  </button>
                ))}
            </div>
          )}
        </div>

        <button
          onClick={send}
          disabled={!draft.trim()}
          className="flex items-center gap-1.5 rounded-xl bg-moss px-3 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-40"
          title="Send (Enter)"
          aria-label="Send"
        >
          <Send size={16} />
          <span className="hidden sm:inline">Send</span>
        </button>
      </div>
      <div className="mt-1 px-1 text-[11px] text-slate-400">
        <kbd className="rounded bg-surface-sunken px-1 dark:bg-ink-800">Enter</kbd> to send ·{" "}
        <kbd className="rounded bg-surface-sunken px-1 dark:bg-ink-800">Shift</kbd>+
        <kbd className="rounded bg-surface-sunken px-1 dark:bg-ink-800">Enter</kbd> for new line
        {draft && (
          <button onClick={() => setDraft(conv.id, "")} className="ml-2 inline-flex items-center gap-1 text-slate-400 hover:text-clay">
            <X size={11} /> clear draft
          </button>
        )}
      </div>
    </div>
  );
}
