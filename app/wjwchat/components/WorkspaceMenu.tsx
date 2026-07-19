import { X, Moon, Sun, RotateCcw, Info } from "lucide-react";
import { useChat } from "../store";
import { workspace, users } from "../seed";
import { isSelf } from "../utils";

export function WorkspaceMenu({ onClose }: { onClose: () => void }) {
  const theme = useChat((s) => s.theme);
  const toggleTheme = useChat((s) => s.toggleTheme);
  const resetDemo = useChat((s) => s.resetDemo);
  const me = users.find((u) => isSelf(u.id))!;

  const confirmReset = () => {
    if (confirm("Reset all demo data? This clears your messages, reactions, and saved items, and restores the seed.")) {
      resetDemo();
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-end bg-black/40 p-3 animate-fade-in sm:p-4"
      onClick={onClose}
    >
      <div
        className="mt-12 w-full max-w-xs overflow-hidden rounded-2xl border border-line bg-surface-raised shadow-pop dark:border-ink-700 dark:bg-ink-900"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Workspace menu"
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3 dark:border-ink-800">
          <div className="flex items-center gap-2">
            <span
              className="flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold text-white"
              style={{ background: workspace.accent }}
            >
              WJ
            </span>
            <span className="text-sm font-semibold text-slate-900 dark:text-white">{workspace.name}</span>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-surface-sunken dark:hover:bg-ink-800" aria-label="Close menu">
            <X size={18} />
          </button>
        </div>

        <div className="p-2">
          <div className="flex items-center gap-2 rounded-lg px-2 py-2">
            <span
              className="flex h-9 w-9 items-center justify-center rounded-xl text-sm font-semibold text-white"
              style={{ background: me.avatarColor }}
            >
              {me.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("")}
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-slate-900 dark:text-white">{me.name}</div>
              <div className="truncate text-xs text-slate-400">{me.title}</div>
            </div>
          </div>

          <MenuRow icon={theme === "dark" ? <Sun size={16} /> : <Moon size={16} />} label={theme === "dark" ? "Light mode" : "Dark mode"} onClick={toggleTheme} />
          <MenuRow icon={<RotateCcw size={16} />} label="Reset demo data" onClick={confirmReset} danger />
          <MenuRow icon={<Info size={16} />} label="About WJW Chat" onClick={onClose} />
        </div>

        <div className="border-t border-line px-4 py-2 text-[11px] text-slate-400 dark:border-ink-800">
          Local demo · no server · state saved in your browser
        </div>
      </div>
    </div>
  );
}

function MenuRow({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm hover:bg-surface-sunken dark:hover:bg-ink-800 ${
        danger ? "text-clay" : "text-slate-700 dark:text-slate-200"
      }`}
    >
      <span className={danger ? "text-clay" : "text-slate-500"}>{icon}</span>
      {label}
    </button>
  );
}
