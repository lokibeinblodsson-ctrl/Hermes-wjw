import { useEffect, useState } from 'react';
import type { Card, Category, Platform, Priority } from '../types';
import { CATEGORIES, PLATFORMS } from '../types';

interface Props {
  card: Card | null;
  onClose: () => void;
  onSave: (patch: Partial<Card>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-charcoal-soft/80">
        {label}
      </span>
      {children}
    </label>
  );
}

const inputCls =
  'w-full rounded-md border border-beige-deep bg-white px-2 py-1.5 text-sm text-charcoal outline-none focus:border-dusty-deep';

export function CardModal({
  card,
  onClose,
  onSave,
  onDelete,
  onDuplicate,
}: Props) {
  const [draft, setDraft] = useState<Card | null>(card);

  useEffect(() => {
    setDraft(card);
  }, [card]);

  if (!draft) return null;

  const set = (patch: Partial<Card>) =>
    setDraft((d) => (d ? { ...d, ...patch } : d));

  const togglePlatform = (p: Platform) =>
    set({
      platforms: draft!.platforms.includes(p)
        ? draft!.platforms.filter((x) => x !== p)
        : [...draft!.platforms, p],
    });

  const commit = () => onSave(draft!);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-charcoal/40 p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="my-6 w-full max-w-2xl rounded-2xl bg-paper p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <input
            className="w-full bg-transparent text-lg font-semibold text-charcoal outline-none"
            value={draft.title}
            placeholder="Card title"
            onChange={(e) => set({ title: e.target.value })}
          />
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-charcoal-soft hover:bg-paper-2"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Description">
            <textarea
              className={inputCls + ' h-24 resize-y'}
              value={draft.description}
              onChange={(e) => set({ description: e.target.value })}
            />
          </Field>

          <div className="flex flex-col gap-4">
            <Field label="Category">
              <select
                className={inputCls}
                value={draft.category}
                onChange={(e) => set({ category: e.target.value as Category })}
              >
                <option value="">— none —</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Priority">
              <select
                className={inputCls}
                value={draft.priority}
                onChange={(e) => set({ priority: e.target.value as Priority })}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Due date">
                <input
                  type="date"
                  className={inputCls}
                  value={draft.dueDate}
                  onChange={(e) => set({ dueDate: e.target.value })}
                />
              </Field>
              <Field label="Target week">
                <input
                  className={inputCls}
                  placeholder="2026-W28"
                  value={draft.targetWeek}
                  onChange={(e) => set({ targetWeek: e.target.value })}
                />
              </Field>
            </div>
          </div>
        </div>

        <Field label="Platforms">
          <div className="flex flex-wrap gap-1.5">
            {PLATFORMS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => togglePlatform(p)}
                className={`rounded-full px-2.5 py-1 text-xs transition ${
                  draft.platforms.includes(p)
                    ? 'bg-dusty-deep text-white'
                    : 'bg-paper-2 text-charcoal-soft hover:bg-beige-deep/50'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </Field>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Tags (comma separated)">
            <input
              className={inputCls}
              value={draft.tags.join(', ')}
              onChange={(e) => set({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })}
              placeholder="education, launch"
            />
          </Field>
          <Field label="Links (one per line)">
            <textarea
              className={inputCls + ' h-16 resize-y'}
              value={draft.links.join('\n')}
              onChange={(e) =>
                set({ links: e.target.value.split('\n').map((t) => t.trim()).filter(Boolean) })
              }
              placeholder="https://…"
            />
          </Field>
        </div>

        <Field label="Notes">
          <textarea
            className={inputCls + ' mt-4 h-16 resize-y'}
            value={draft.notes}
            onChange={(e) => set({ notes: e.target.value })}
          />
        </Field>

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <Field label="Content pillar">
            <input
              className={inputCls + ' w-56'}
              value={draft.contentPillar || ''}
              onChange={(e) => set({ contentPillar: e.target.value })}
              placeholder="Education"
            />
          </Field>
          <label className="mt-5 flex items-center gap-2 text-sm text-charcoal-soft">
            <input
              type="checkbox"
              checked={!!draft.platformReady}
              onChange={(e) => set({ platformReady: e.target.checked })}
            />
            Platform-ready
          </label>
        </div>

        <div className="mt-5 flex items-center justify-between border-t border-beige-deep/60 pt-4">
          <div className="flex gap-2">
            <button
              onClick={onDuplicate}
              className="rounded-md bg-paper-2 px-3 py-1.5 text-sm text-charcoal-soft hover:bg-beige-deep/50"
            >
              Duplicate
            </button>
            <button
              onClick={onDelete}
              className="rounded-md px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
            >
              Delete
            </button>
          </div>
          <button
            onClick={commit}
            className="rounded-md bg-dusty-deep px-4 py-1.5 text-sm font-medium text-white hover:opacity-90"
          >
            Save
          </button>
        </div>
        <p className="mt-2 text-[10px] text-charcoal-soft/60">
          Updated {new Date(draft.updatedAt).toLocaleString()}
        </p>
      </div>
    </div>
  );
}
