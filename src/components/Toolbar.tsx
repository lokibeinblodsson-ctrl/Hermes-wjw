import type { Category, Platform, Priority } from '../types';
import { CATEGORIES, PLATFORMS } from '../types';

export interface Filters {
  search: string;
  category: Category | '';
  platform: Platform | '';
  priority: Priority | '';
  sortBy: 'priority' | 'dueDate' | 'recent';
}

interface Props {
  filters: Filters;
  setFilters: (f: Filters) => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onResetSeed: () => void;
}

const selectCls =
  'rounded-md border border-beige-deep bg-white px-2 py-1 text-sm text-charcoal outline-none focus:border-dusty-deep';

export function Toolbar({
  filters,
  setFilters,
  onExport,
  onImport,
  onResetSeed,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-beige-deep/60 bg-paper/80 px-4 py-3 backdrop-blur">
      <input
        className="min-w-[180px] flex-1 rounded-md border border-beige-deep bg-white px-3 py-1.5 text-sm text-charcoal outline-none focus:border-dusty-deep"
        placeholder="Search title or description…"
        value={filters.search}
        onChange={(e) => setFilters({ ...filters, search: e.target.value })}
      />

      <select
        className={selectCls}
        value={filters.category}
        onChange={(e) => setFilters({ ...filters, category: e.target.value as Category })}
      >
        <option value="">All categories</option>
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <select
        className={selectCls}
        value={filters.platform}
        onChange={(e) => setFilters({ ...filters, platform: e.target.value as Platform })}
      >
        <option value="">All platforms</option>
        {PLATFORMS.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>

      <select
        className={selectCls}
        value={filters.priority}
        onChange={(e) =>
          setFilters({ ...filters, priority: e.target.value as Priority })
        }
      >
        <option value="">Any priority</option>
        <option value="high">High</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
      </select>

      <select
        className={selectCls}
        value={filters.sortBy}
        onChange={(e) =>
          setFilters({
            ...filters,
            sortBy: e.target.value as Filters['sortBy'],
          })
        }
      >
        <option value="recent">Recent</option>
        <option value="priority">Priority</option>
        <option value="dueDate">Due date</option>
      </select>

      <div className="ml-auto flex gap-2">
        <button
          onClick={onExport}
          className="rounded-md bg-paper-2 px-3 py-1.5 text-sm text-charcoal-soft hover:bg-beige-deep/50"
        >
          Export
        </button>
        <label className="cursor-pointer rounded-md bg-paper-2 px-3 py-1.5 text-sm text-charcoal-soft hover:bg-beige-deep/50">
          Import
          <input
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImport(f);
              e.currentTarget.value = '';
            }}
          />
        </label>
        <button
          onClick={onResetSeed}
          className="rounded-md px-3 py-1.5 text-sm text-charcoal-soft/70 hover:bg-paper-2"
          title="Reload the starter cards"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
