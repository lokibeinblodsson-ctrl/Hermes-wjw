import { useEffect, useRef, useState } from 'react';
import type {
  Card,
  Category,
  Platform,
  Priority,
  MediaItem,
  ResourceLink,
  CustomField,
  ChecklistItem,
} from '../types';
import { CATEGORIES, PLATFORMS, COLUMNS } from '../types';
import { uid } from './helpers';

interface Props {
  card: Card;
  onClose: () => void;
  onPatch: (patch: Partial<Card>) => void;
  onSave: () => void;
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

type Tab = 'draft' | 'media' | 'resources' | 'checklist' | 'custom' | 'notes';

function kindOf(type: string): MediaItem['kind'] {
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  return 'file';
}

export function CardWorkspace({
  card,
  onClose,
  onPatch,
  onSave,
  onDelete,
  onDuplicate,
}: Props) {
  const [tab, setTab] = useState<Tab>('draft');
  const fileRef = useRef<HTMLInputElement>(null);

  // Keep local draft for the big textareas so typing stays snappy; flush on blur.
  const [draftText, setDraftText] = useState(card.draft);
  const [notesText, setNotesText] = useState(card.notes);
  useEffect(() => {
    setDraftText(card.draft);
    setNotesText(card.notes);
  }, [card.id, card.draft, card.notes]);

  const set = (patch: Partial<Card>) => onPatch(patch);

  const togglePlatform = (p: Platform) =>
    set({
      platforms: card.platforms.includes(p)
        ? card.platforms.filter((x) => x !== p)
        : [...card.platforms, p],
    });

  const addResource = () =>
    set({
      resources: [...card.resources, { id: uid(), title: '', url: '', note: '' }],
    });
  const patchResource = (id: string, patch: Partial<ResourceLink>) =>
    set({
      resources: card.resources.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    });
  const removeResource = (id: string) =>
    set({ resources: card.resources.filter((r) => r.id !== id) });

  const addChecklist = () =>
    set({ checklist: [...card.checklist, { id: uid(), text: '', done: false }] });
  const patchChecklist = (id: string, patch: Partial<ChecklistItem>) =>
    set({
      checklist: card.checklist.map((c) =>
        c.id === id ? { ...c, ...patch } : c,
      ),
    });
  const removeChecklist = (id: string) =>
    set({ checklist: card.checklist.filter((c) => c.id !== id) });

  const addCustom = () =>
    set({ customFields: [...card.customFields, { id: uid(), label: '', value: '' }] });
  const patchCustom = (id: string, patch: Partial<CustomField>) =>
    set({
      customFields: card.customFields.map((c) =>
        c.id === id ? { ...c, ...patch } : c,
      ),
    });
  const removeCustom = (id: string) =>
    set({ customFields: card.customFields.filter((c) => c.id !== id) });

  const onFiles = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        const item: MediaItem = {
          id: uid(),
          name: file.name,
          kind: kindOf(file.type),
          type: file.type || 'application/octet-stream',
          dataUrl: String(reader.result),
          size: file.size,
        };
        set({ media: [...card.media, item] });
      };
      reader.readAsDataURL(file);
    });
    if (fileRef.current) fileRef.current.value = '';
  };

  const removeMedia = (id: string) =>
    set({ media: card.media.filter((m) => m.id !== id) });

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: 'draft', label: 'Draft', badge: card.draft ? 1 : 0 },
    { id: 'media', label: 'Media', badge: card.media.length },
    { id: 'resources', label: 'Resources', badge: card.resources.length },
    { id: 'checklist', label: 'Checklist', badge: card.checklist.length },
    { id: 'custom', label: 'Details', badge: card.customFields.length },
    { id: 'notes', label: 'Notes', badge: card.notes ? 1 : 0 },
  ];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-paper">
      {/* Top bar */}
      <div className="flex items-center gap-3 border-b border-beige-deep/60 bg-charcoal px-4 py-2.5 text-paper">
        <button
          onClick={onClose}
          className="rounded-md bg-paper/10 px-3 py-1.5 text-xs hover:bg-paper/20"
        >
          ← Board
        </button>
        <input
          className="flex-1 bg-transparent text-base font-semibold text-paper outline-none placeholder:text-paper/40"
          value={card.title}
          placeholder="Card title"
          onChange={(e) => set({ title: e.target.value })}
        />
        <select
          className="rounded-md border border-paper/20 bg-charcoal px-2 py-1.5 text-xs text-paper outline-none"
          value={card.status}
          onChange={(e) => set({ status: e.target.value as Card['status'] })}
        >
          {COLUMNS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-paper/80">
          <input
            type="checkbox"
            checked={!!card.platformReady}
            onChange={(e) => set({ platformReady: e.target.checked })}
          />
          Ready
        </label>
        <button
          onClick={onDuplicate}
          className="rounded-md bg-paper/10 px-3 py-1.5 text-xs hover:bg-paper/20"
        >
          Duplicate
        </button>
        <button
          onClick={onDelete}
          className="rounded-md px-3 py-1.5 text-xs text-red-200 hover:bg-red-500/20"
        >
          Delete
        </button>
        <button
          onClick={onSave}
          className="rounded-md bg-dusty-deep px-4 py-1.5 text-xs font-medium text-white hover:opacity-90"
        >
          Done
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Left meta rail */}
        <aside className="w-72 shrink-0 space-y-4 overflow-y-auto border-r border-beige-deep/60 bg-paper-2 p-4">
          <Field label="Description">
            <textarea
              className={inputCls + ' h-24 resize-y'}
              value={card.description}
              onChange={(e) => set({ description: e.target.value })}
            />
          </Field>
          <Field label="Category">
            <select
              className={inputCls}
              value={card.category}
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
              value={card.priority}
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
                value={card.dueDate}
                onChange={(e) => set({ dueDate: e.target.value })}
              />
            </Field>
            <Field label="Target week">
              <input
                className={inputCls}
                placeholder="2026-W28"
                value={card.targetWeek}
                onChange={(e) => set({ targetWeek: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Platforms">
            <div className="flex flex-wrap gap-1.5">
              {PLATFORMS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => togglePlatform(p)}
                  className={`rounded-full px-2.5 py-1 text-xs transition ${
                    card.platforms.includes(p)
                      ? 'bg-dusty-deep text-white'
                      : 'bg-white text-charcoal-soft hover:bg-beige-deep/50'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Tags (comma separated)">
            <input
              className={inputCls}
              value={card.tags.join(', ')}
              onChange={(e) =>
                set({
                  tags: e.target.value
                    .split(',')
                    .map((t) => t.trim())
                    .filter(Boolean),
                })
              }
              placeholder="education, launch"
            />
          </Field>
          <Field label="Content pillar">
            <input
              className={inputCls}
              value={card.contentPillar || ''}
              onChange={(e) => set({ contentPillar: e.target.value })}
              placeholder="Education"
            />
          </Field>
        </aside>

        {/* Main panel */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex gap-1 border-b border-beige-deep/60 px-4 pt-3">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`relative rounded-t-md px-3 py-2 text-sm transition ${
                  tab === t.id
                    ? 'bg-white text-charcoal shadow-sm'
                    : 'text-charcoal-soft hover:bg-white/50'
                }`}
              >
                {t.label}
                {t.badge ? (
                  <span className="ml-1.5 rounded-full bg-dusty-deep/20 px-1.5 py-0.5 text-[10px] text-charcoal">
                    {t.badge}
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {tab === 'draft' && (
              <div className="mx-auto max-w-3xl">
                <p className="mb-2 text-xs text-charcoal-soft">
                  Working draft / current copy for this piece.
                </p>
                <textarea
                  className="h-[60vh] w-full resize-none rounded-lg border border-beige-deep bg-white p-3 text-sm leading-relaxed text-charcoal outline-none focus:border-dusty-deep"
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  onBlur={() => set({ draft: draftText })}
                  placeholder="Write the draft here…"
                />
              </div>
            )}

            {tab === 'media' && (
              <div className="mx-auto max-w-4xl">
                <div className="mb-3 flex items-center gap-3">
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="rounded-md bg-dusty-deep px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
                  >
                    + Add media
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    multiple
                    accept="image/*,video/*"
                    className="hidden"
                    onChange={(e) => onFiles(e.target.files)}
                  />
                  <span className="text-xs text-charcoal-soft">
                    Stored in-browser (localStorage). Keep files small.
                  </span>
                </div>
                {card.media.length === 0 ? (
                  <p className="text-sm text-charcoal-soft">
                    No media yet. Add images or videos for this project.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {card.media.map((m) => (
                      <div
                        key={m.id}
                        className="group relative overflow-hidden rounded-lg border border-beige-deep bg-white"
                      >
                        {m.kind === 'image' ? (
                          <img
                            src={m.dataUrl}
                            alt={m.name}
                            className="h-32 w-full object-cover"
                          />
                        ) : m.kind === 'video' ? (
                          <video
                            src={m.dataUrl}
                            controls
                            className="h-32 w-full bg-black object-contain"
                          />
                        ) : (
                          <div className="flex h-32 items-center justify-center text-xs text-charcoal-soft">
                            {m.name}
                          </div>
                        )}
                        <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                          <span className="truncate text-[11px] text-charcoal-soft">
                            {m.name}
                          </span>
                          <button
                            onClick={() => removeMedia(m.id)}
                            className="shrink-0 text-[11px] text-red-700 hover:underline"
                          >
                            remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === 'resources' && (
              <div className="mx-auto max-w-3xl space-y-3">
                {card.resources.map((r) => (
                  <div
                    key={r.id}
                    className="rounded-lg border border-beige-deep bg-white p-3"
                  >
                    <div className="flex gap-2">
                      <input
                        className={inputCls + ' flex-1'}
                        placeholder="Label (e.g. Reference article)"
                        value={r.title}
                        onChange={(e) => patchResource(r.id, { title: e.target.value })}
                      />
                      <button
                        onClick={() => removeResource(r.id)}
                        className="shrink-0 px-2 text-sm text-red-700 hover:underline"
                      >
                        ✕
                      </button>
                    </div>
                    <input
                      className={inputCls + ' mt-2'}
                      placeholder="https://…"
                      value={r.url}
                      onChange={(e) => patchResource(r.id, { url: e.target.value })}
                    />
                    <input
                      className={inputCls + ' mt-2'}
                      placeholder="Optional note"
                      value={r.note || ''}
                      onChange={(e) => patchResource(r.id, { note: e.target.value })}
                    />
                  </div>
                ))}
                <button
                  onClick={addResource}
                  className="rounded-md bg-paper-2 px-3 py-1.5 text-sm text-charcoal-soft hover:bg-beige-deep/50"
                >
                  + Add resource link
                </button>
              </div>
            )}

            {tab === 'checklist' && (
              <div className="mx-auto max-w-3xl space-y-2">
                {card.checklist.map((c) => (
                  <div key={c.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={c.done}
                      onChange={(e) => patchChecklist(c.id, { done: e.target.checked })}
                    />
                    <input
                      className={inputCls + (c.done ? ' line-through opacity-60' : '')}
                      value={c.text}
                      placeholder="Step…"
                      onChange={(e) => patchChecklist(c.id, { text: e.target.value })}
                    />
                    <button
                      onClick={() => removeChecklist(c.id)}
                      className="shrink-0 px-2 text-sm text-red-700 hover:underline"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  onClick={addChecklist}
                  className="rounded-md bg-paper-2 px-3 py-1.5 text-sm text-charcoal-soft hover:bg-beige-deep/50"
                >
                  + Add step
                </button>
              </div>
            )}

            {tab === 'custom' && (
              <div className="mx-auto max-w-3xl space-y-2">
                {card.customFields.map((c) => (
                  <div key={c.id} className="flex items-center gap-2">
                    <input
                      className={inputCls + ' w-40 shrink-0'}
                      placeholder="Field label"
                      value={c.label}
                      onChange={(e) => patchCustom(c.id, { label: e.target.value })}
                    />
                    <input
                      className={inputCls + ' flex-1'}
                      placeholder="Value"
                      value={c.value}
                      onChange={(e) => patchCustom(c.id, { value: e.target.value })}
                    />
                    <button
                      onClick={() => removeCustom(c.id)}
                      className="shrink-0 px-2 text-sm text-red-700 hover:underline"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  onClick={addCustom}
                  className="rounded-md bg-paper-2 px-3 py-1.5 text-sm text-charcoal-soft hover:bg-beige-deep/50"
                >
                  + Add custom field
                </button>
              </div>
            )}

            {tab === 'notes' && (
              <div className="mx-auto max-w-3xl">
                <textarea
                  className="h-[60vh] w-full resize-none rounded-lg border border-beige-deep bg-white p-3 text-sm leading-relaxed text-charcoal outline-none focus:border-dusty-deep"
                  value={notesText}
                  onChange={(e) => setNotesText(e.target.value)}
                  onBlur={() => set({ notes: notesText })}
                  placeholder="Free-form notes, ideas, reminders…"
                />
              </div>
            )}
          </div>

          <p className="border-t border-beige-deep/60 px-4 py-1.5 text-[10px] text-charcoal-soft/70">
            Autosaved · updated {new Date(card.updatedAt).toLocaleString()}
          </p>
        </main>
      </div>
    </div>
  );
}
