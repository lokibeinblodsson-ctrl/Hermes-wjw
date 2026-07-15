import type { Card } from '../types';
import { COLUMNS, CATEGORIES } from '../types';

interface Props {
  cards: Card[];
}

export function Analytics({ cards }: Props) {
  const byStatus = COLUMNS.map((col) => ({
    title: col.title,
    count: cards.filter((c) => c.status === col.id).length,
    accent: col.accent,
  }));

  const byCategory = CATEGORIES.map((cat) => ({
    cat,
    count: cards.filter((c) => c.category === cat).length,
  })).filter((x) => x.count > 0);

  const total = cards.length;
  const ready = cards.filter((c) => c.platformReady).length;

  return (
    <div className="w-72 shrink-0 rounded-xl bg-paper-2/70 p-3">
      <h3 className="mb-2 text-sm font-semibold text-charcoal">Board analytics</h3>

      <div className="mb-1 flex justify-between text-xs text-charcoal-soft">
        <span>Total cards</span>
        <span className="font-medium text-charcoal">{total}</span>
      </div>
      <div className="mb-3 flex justify-between text-xs text-charcoal-soft">
        <span>Platform-ready</span>
        <span className="font-medium text-charcoal">{ready}</span>
      </div>

      <div className="space-y-1.5">
        {byStatus.map((s) => (
          <div key={s.title}>
            <div className="flex justify-between text-[11px] text-charcoal-soft">
              <span>{s.title}</span>
              <span>{s.count}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/60">
              <div
                className="h-full rounded-full"
                style={{
                  width: total ? `${(s.count / total) * 100}%` : '0%',
                  background: s.accent,
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {byCategory.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-charcoal-soft/80">
            By category
          </p>
          <div className="flex flex-wrap gap-1">
            {byCategory.map((c) => (
              <span
                key={c.cat}
                className="rounded-full bg-sage/40 px-2 py-0.5 text-[10px] text-charcoal-soft"
              >
                {c.cat} · {c.count}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
