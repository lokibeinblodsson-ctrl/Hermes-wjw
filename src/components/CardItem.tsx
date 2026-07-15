import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Card } from '../types';
import { priorityColor } from './helpers';

interface Props {
  card: Card;
  onOpen: (id: string) => void;
}

export function CardItem({ card, onOpen }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: card.id, data: { status: card.status } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(card.id)}
      className={`group cursor-pointer rounded-lg border border-beige-deep/60 bg-white p-3 shadow-sm transition hover:shadow-md ${
        isDragging ? 'card-dragging' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-medium leading-snug text-charcoal">
          {card.title || '(untitled)'}
        </h4>
        <span
          className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: priorityColor(card.priority) }}
          title={`${card.priority} priority`}
        />
      </div>

      {card.category && (
        <span className="mt-2 inline-block rounded-full bg-sage/40 px-2 py-0.5 text-[11px] text-charcoal-soft">
          {card.category}
        </span>
      )}

      <div className="mt-2 flex flex-wrap gap-1">
        {card.platforms.slice(0, 3).map((p) => (
          <span
            key={p}
            className="rounded bg-dusty/30 px-1.5 py-0.5 text-[10px] text-charcoal-soft"
          >
            {p}
          </span>
        ))}
        {card.platforms.length > 3 && (
          <span className="text-[10px] text-charcoal-soft">
            +{card.platforms.length - 3}
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between text-[10px] text-charcoal-soft/80">
        <span>
          {card.targetWeek || ''}
          {card.dueDate ? ` · ${card.dueDate}` : ''}
        </span>
        {card.platformReady && (
          <span className="rounded bg-sage-deep/30 px-1.5 py-0.5 text-[10px] text-charcoal">
            ready
          </span>
        )}
      </div>
    </div>
  );
}
