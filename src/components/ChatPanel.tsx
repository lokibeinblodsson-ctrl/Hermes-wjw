import { useEffect, useRef, useState } from 'react';
import { streamChat } from '../api';
import type { Card } from '../types';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

interface Props {
  cards: Card[];
  user: { displayName: string };
}

export function ChatPanel({ cards, user }: Props) {
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: 'assistant',
      content:
        "Hi! I'm Hermes, embedded in your planner. Ask me to draft content, summarize the board, or suggest next steps.",
    },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const boardSummary = () =>
    cards
      .map(
        (c) =>
          `- ${c.title} [${c.status}]${c.platforms.length ? ' → ' + c.platforms.join(', ') : ''}`,
      )
      .join('\n');

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    const next = [...messages, { role: 'user' as const, content: text }];
    setMessages(next);
    setBusy(true);

    const history = [
      {
        role: 'system' as const,
        content: `Current board (${cards.length} cards):\n${boardSummary()}`,
      },
      ...next.map((m) => ({ role: m.role, content: m.content })),
    ];

    // append an empty assistant message we will fill
    setMessages([...next, { role: 'assistant', content: '' }]);
    try {
      await streamChat(history, (delta) => {
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = {
            role: 'assistant',
            content: copy[copy.length - 1].content + delta,
          };
          return copy;
        });
      });
    } catch (e) {
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = {
          role: 'assistant',
          content: `⚠️ Error: ${e instanceof Error ? e.message : String(e)}`,
        };
        return copy;
      });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  return (
    <div className="flex h-full flex-col bg-paper">
      <div className="border-b border-beige-deep/60 bg-charcoal px-4 py-2.5 text-paper">
        <h2 className="text-sm font-semibold">Hermes Chat</h2>
        <p className="text-[10px] text-paper/60">
          Working with {user.displayName} · live board context included
        </p>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
                m.role === 'user'
                  ? 'bg-dusty-deep text-white'
                  : 'bg-white text-charcoal shadow-sm'
              }`}
            >
              {m.content || (busy && i === messages.length - 1 ? '…' : '')}
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-2 border-t border-beige-deep/60 p-3">
        <textarea
          className="flex-1 resize-none rounded-md border border-beige-deep bg-white px-2 py-1.5 text-sm text-charcoal outline-none focus:border-dusty-deep"
          rows={2}
          placeholder="Message Hermes…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button
          onClick={send}
          disabled={busy}
          className="rounded-md bg-dusty-deep px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
