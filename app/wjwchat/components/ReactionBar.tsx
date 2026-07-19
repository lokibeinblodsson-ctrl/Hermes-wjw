import { useChat } from "../store";
import type { Message } from "../types";

export function ReactionBar({
  message,
  onToggle,
}: {
  message: Message;
  onToggle: (id: string, emoji: string) => void;
}) {
  const me = useChat((s) => s.currentUserId);
  return (
    <div className="flex flex-wrap gap-1">
      {message.reactions.map((r) => {
        const mine = r.userIds.includes(me);
        return (
          <button
            key={r.emoji}
            onClick={() => onToggle(message.id, r.emoji)}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors ${
              mine
                ? "border-moss/50 bg-moss/15 text-slate-800 dark:text-slate-100"
                : "border-line bg-surface-raised text-slate-600 hover:border-moss/40 dark:border-ink-700 dark:bg-ink-850"
            }`}
            title={`${r.userIds.length} reacted`}
          >
            <span className="text-sm leading-none">{r.emoji}</span>
            <span className="font-medium">{r.userIds.length}</span>
          </button>
        );
      })}
    </div>
  );
}
