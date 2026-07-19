import { useState } from "react";
import {
  Smile,
  MessageSquare,
  Bookmark,
  BookmarkCheck,
  Pencil,
  MoreHorizontal,
  AlertCircle,
  Clock,
} from "lucide-react";
import { useChat } from "../store";
import { getUser, isSelf, renderText, formatTime, formatFull } from "../utils";
import type { Message } from "../types";
import { ReactionBar } from "./ReactionBar";
import { AttachmentCard } from "./AttachmentCard";

const QUICK_EMOJI = ["👍", "💛", "🌿", "🎉", "🙏", "😂"];

export function MessageItem({
  message,
  isThreadOpen,
  showHeader,
  compact,
}: {
  message: Message;
  isThreadOpen?: boolean;
  showHeader?: boolean;
  compact?: boolean;
}) {
  const toggleReaction = useChat((s) => s.toggleReaction);
  const toggleSave = useChat((s) => s.toggleSave);
  const setThreadPanel = useChat((s) => s.setThreadPanel);
  const editMessage = useChat((s) => s.editMessage);
  const retryMessage = useChat((s) => s.retryMessage);

  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(message.text);
  const [pickerOpen, setPickerOpen] = useState(false);

  const sender = getUser(message.senderId);
  const mine = isSelf(message.senderId);
  const canEdit = mine;

  const save = () => {
    if (!editText.trim() || editText === message.text) {
      setEditing(false);
      setEditText(message.text);
      return;
    }
    editMessage(message.id, editText.trim());
    setEditing(false);
  };

  return (
    <div
      className={`group relative flex gap-3 rounded-lg px-2 py-1 hover:bg-surface-sunken/70 dark:hover:bg-ink-900/60 ${
        isThreadOpen ? "bg-moss/10 ring-1 ring-moss/40" : ""
      } ${compact ? "py-0.5" : ""}`}
    >
      {/* avatar */}
      <div className="w-9 shrink-0">
        {showHeader && !compact ? (
          <span
            className="flex h-9 w-9 items-center justify-center rounded-xl text-sm font-semibold text-white"
            style={{ background: sender.avatarColor, borderRadius: 11 }}
          >
            {sender.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
          </span>
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        {showHeader && !compact && (
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-slate-900 dark:text-white">{sender.name}</span>
            <span className="text-[11px] text-slate-400" title={formatFull(message.createdAt)}>
              {formatTime(message.createdAt)}
            </span>
          </div>
        )}

        {editing ? (
          <div className="mt-0.5">
            <textarea
              autoFocus
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  save();
                }
                if (e.key === "Escape") {
                  setEditing(false);
                  setEditText(message.text);
                }
              }}
              rows={Math.max(1, editText.split("\n").length)}
              className="composer-input w-full rounded-lg border border-line bg-surface-raised px-2 py-1 text-sm outline-none dark:border-ink-700 dark:bg-ink-850"
            />
            <div className="mt-1 flex gap-2 text-xs">
              <button onClick={save} className="rounded bg-moss px-2 py-1 font-medium text-ink-950">
                Save
              </button>
              <button
                onClick={() => {
                  setEditing(false);
                  setEditText(message.text);
                }}
                className="rounded px-2 py-1 text-slate-500 hover:bg-surface-sunken dark:hover:bg-ink-800"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div
            className="text-sm leading-relaxed text-slate-800 dark:text-slate-200"
            dangerouslySetInnerHTML={{ __html: renderText(message.text) }}
          />
        )}

        {message.editedAt && !editing && (
          <span className="text-[11px] italic text-slate-400">(edited)</span>
        )}

        {/* attachments */}
        {message.attachments?.map((a) => (
          <AttachmentCard key={a.id} att={a} />
        ))}

        {/* delivery status for my messages */}
        {mine && message.deliveryStatus !== "sent" && (
          <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-slate-400">
            {message.deliveryStatus === "sending" ? (
              <>
                <Clock size={12} /> sending…
              </>
            ) : (
              <>
                <AlertCircle size={12} className="text-clay" /> failed to send
                <button
                  onClick={() => retryMessage(message.id)}
                  className="ml-1 rounded bg-clay/20 px-1.5 py-0.5 font-medium text-clay hover:bg-clay/30"
                >
                  Retry
                </button>
              </>
            )}
          </span>
        )}

        {/* reactions */}
        {message.reactions.length > 0 && (
          <div className="mt-1.5">
            <ReactionBar message={message} onToggle={toggleReaction} />
          </div>
        )}

        {/* thread reply count */}
        {message.replyCount > 0 && (
          <button
            onClick={() => setThreadPanel(message.id)}
            className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-raised px-2 py-1 text-xs font-medium text-moss hover:border-moss/50 dark:border-ink-700 dark:bg-ink-850"
          >
            <MessageSquare size={13} />
            {message.replyCount} {message.replyCount === 1 ? "reply" : "replies"}
            <span className="text-slate-400">· view thread</span>
          </button>
        )}
      </div>

      {/* hover actions */}
      {!editing && (
        <div
          className={`absolute -top-3 right-3 hidden items-center gap-0.5 rounded-lg border border-line bg-surface-raised p-0.5 shadow-panel group-hover:flex dark:border-ink-700 dark:bg-ink-850 ${
            pickerOpen ? "flex" : ""
          }`}
        >
          {/* reaction picker */}
          <div className="relative">
            <button
              onClick={() => setPickerOpen((v) => !v)}
              className="rounded p-1.5 text-slate-500 hover:bg-surface-sunken dark:hover:bg-ink-800"
              title="Add reaction"
              aria-label="Add reaction"
            >
              <Smile size={16} />
            </button>
            {pickerOpen && (
              <div className="absolute right-0 top-9 z-20 flex gap-1 rounded-lg border border-line bg-surface-raised p-1 shadow-pop animate-pop-in dark:border-ink-700 dark:bg-ink-850">
                {QUICK_EMOJI.map((e) => (
                  <button
                    key={e}
                    onClick={() => {
                      toggleReaction(message.id, e);
                      setPickerOpen(false);
                    }}
                    className="rounded p-1 text-lg hover:bg-surface-sunken dark:hover:bg-ink-800"
                  >
                    {e}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => setThreadPanel(message.id)}
            className="rounded p-1.5 text-slate-500 hover:bg-surface-sunken dark:hover:bg-ink-800"
            title="Reply in thread"
            aria-label="Reply in thread"
          >
            <MessageSquare size={16} />
          </button>
          <button
            onClick={() => toggleSave(message.id)}
            className={`rounded p-1.5 hover:bg-surface-sunken dark:hover:bg-ink-800 ${
              message.isSaved ? "text-moss" : "text-slate-500"
            }`}
            title={message.isSaved ? "Unsave" : "Save"}
            aria-label={message.isSaved ? "Unsave" : "Save"}
          >
            {message.isSaved ? <BookmarkCheck size={16} /> : <Bookmark size={16} />}
          </button>
          {canEdit && (
            <button
              onClick={() => setEditing(true)}
              className="rounded p-1.5 text-slate-500 hover:bg-surface-sunken dark:hover:bg-ink-800"
              title="Edit"
              aria-label="Edit"
            >
              <Pencil size={16} />
            </button>
          )}
          <button
            className="rounded p-1.5 text-slate-500 hover:bg-surface-sunken dark:hover:bg-ink-800"
            title="More actions"
            aria-label="More actions"
          >
            <MoreHorizontal size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
