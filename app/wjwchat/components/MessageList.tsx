import { useEffect, useRef, useMemo } from "react";
import { useChat } from "../store";
import type { Conversation } from "../types";
import { dayLabel } from "../utils";
import { MessageItem } from "./MessageItem";

export function MessageList({ conv }: { conv: Conversation }) {
  const messages = useChat((s) => s.messages);
  const threadPanelMessageId = useChat((s) => s.threadPanelMessageId);
  const scrollRef = useRef<HTMLDivElement>(null);

  const list = useMemo(
    () => messages.filter((m) => m.conversationId === conv.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [messages, conv.id]
  );

  // auto-scroll to bottom on new messages / conversation switch
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [list.length, conv.id]);

  // day-change markers
  let lastDay = "";
  return (
    <div ref={scrollRef} className="scroll-thin flex-1 overflow-y-auto px-2 py-3 md:px-4">
      {list.length === 0 ? (
        <div className="flex h-full items-center justify-center text-center text-sm text-slate-400">
          No messages yet. Say something to start the conversation.
        </div>
      ) : (
        list.map((m) => {
          const day = dayLabel(m.createdAt);
          const showDay = day !== lastDay;
          lastDay = day;
          return (
            <div key={m.id}>
              {showDay && (
                <div className="my-3 flex items-center gap-3">
                  <div className="h-px flex-1 bg-line dark:bg-ink-800" />
                  <span className="rounded-full bg-surface-sunken px-3 py-0.5 text-xs font-medium text-slate-500 dark:bg-ink-800 dark:text-slate-300">
                    {day}
                  </span>
                  <div className="h-px flex-1 bg-line dark:bg-ink-800" />
                </div>
              )}
              <MessageItem
                message={m}
                isThreadOpen={threadPanelMessageId === m.id}
                showHeader={true}
              />
            </div>
          );
        })
      )}
    </div>
  );
}
