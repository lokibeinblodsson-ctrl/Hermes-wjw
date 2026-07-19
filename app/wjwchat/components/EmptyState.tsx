export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="max-w-sm px-6 text-center">
      <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-moss/15 text-2xl">🌿</div>
      <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{title}</h2>
      {hint && <p className="mt-1 text-sm text-slate-500">{hint}</p>}
    </div>
  );
}
