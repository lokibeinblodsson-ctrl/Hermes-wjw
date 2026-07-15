import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import type { Card, CardStatus } from '../types';
import { CardItem } from './CardItem';

interface Props {
  id: CardStatus;
  title: string;
  accent: string;
  cards: Card[];
  onOpen: (id: string) => void;
  onAdd: (status: CardStatus) => void;
}

export function Column({ id, title, accent, cards, onOpen, onAdd }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div className="flex w-72 shrink-0 flex-col rounded-xl bg-paper-2/70">
      <div
        className="flex items-center justify-between rounded-t-xl px-3 py-2"
        style={{ borderTop: `3px solid ${accent}` }}
      >
        <h3 className="text-sm font-semibold text-charcoal">{title}</h3>
        <span className="rounded-full bg-white/70 px-2 text-xs text-charcoal-soft">
          {cards.length}
        </span>
      </div>

      <div
        ref={setNodeRef}
        className={`flex min-h-[120px] flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 ${
          isOver ? 'column-over rounded-b-xl' : ''
        }`}
      >
        <SortableContext
          items={cards.map((c) => c.id)}
          strategy={verticalListSortingStrategy}
        >
          {cards.map((c) => (
            <CardItem key={c.id} card={c} onOpen={onOpen} />
          ))}
        </SortableContext>

        {cards.length === 0 && (
          <button
            onClick={() => onAdd(id)}
            className="rounded-lg border border-dashed border-beige-deep py-6 text-xs text-charcoal-soft/70 hover:bg-white/50"
          >
            + Add a card
          </button>
        )}
      </div>

      <button
        onClick={() => onAdd(id)}
        className="m-2 rounded-lg bg-white/60 py-1.5 text-xs text-charcoal-soft hover:bg-white"
      >
        + Add card
      </button>
    </div>
  );
}
