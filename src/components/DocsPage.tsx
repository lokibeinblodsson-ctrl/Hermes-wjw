import { useMemo, useState } from 'react';
import type { Card } from '../types';
import { buildDocs } from '../docs';
import { APP_NAME, APP_VERSION, STORAGE_KEY } from '../storage';

interface Props {
  cards: Card[];
  onClose: () => void;
}

export function DocsPage({ cards, onClose }: Props) {
  const sections = useMemo(() => buildDocs(cards), [cards]);
  const [copied, setCopied] = useState(false);

  const copyAll = async () => {
    const text = [
      `# ${APP_NAME} — Documentation`,
      `Version ${APP_VERSION}`,
      '',
      ...sections.flatMap((s) => [`## ${s.title}`, '', s.body, '']),
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be blocked; ignore */
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-paper">
      <div className="flex items-center gap-3 border-b border-beige-deep/60 bg-charcoal px-4 py-2.5 text-paper">
        <button
          onClick={onClose}
          className="rounded-md bg-paper/10 px-3 py-1.5 text-xs hover:bg-paper/20"
        >
          ← Board
        </button>
        <h2 className="text-base font-semibold">Documentation & Instructions</h2>
        <span className="text-xs text-paper/60">
          v{APP_VERSION} · auto-generated from live app
        </span>
        <div className="ml-auto flex gap-2">
          <button
            onClick={copyAll}
            className="rounded-md bg-paper/10 px-3 py-1.5 text-xs hover:bg-paper/20"
          >
            {copied ? 'Copied!' : 'Copy all'}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-6 p-6">
          <p className="rounded-lg bg-paper-2 p-3 text-xs text-charcoal-soft">
            This page is generated from the running app — it always reflects the
            current columns, categories, platforms, and board contents. Storage
            key: <code>{STORAGE_KEY}</code>.
          </p>
          {sections.map((s) => (
            <section
              key={s.title}
              className="rounded-xl border border-beige-deep/60 bg-white p-4"
            >
              <h3 className="mb-2 text-sm font-semibold text-charcoal">
                {s.title}
              </h3>
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-charcoal-soft">
                {s.body}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
