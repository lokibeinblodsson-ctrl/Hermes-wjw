import { FileText, Link2, Image as ImageIcon, Download } from "lucide-react";
import type { Attachment } from "../types";

export function AttachmentCard({ att }: { att: Attachment }) {
  if (att.kind === "image" && att.swatch) {
    return (
      <div className="mt-1.5 w-fit overflow-hidden rounded-xl border border-line dark:border-ink-700">
        <div
          className="flex h-32 w-56 items-end p-2"
          style={{ background: `linear-gradient(135deg, ${att.swatch[0]}, ${att.swatch[1]})` }}
        >
          <span className="rounded bg-black/25 px-1.5 py-0.5 text-xs text-white backdrop-blur">
            <ImageIcon size={12} className="mr-1 inline" />
            {att.name}
          </span>
        </div>
      </div>
    );
  }
  const Icon = att.kind === "link" ? Link2 : FileText;
  return (
    <a
      href={att.url || "#"}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1.5 flex w-fit items-center gap-2 rounded-xl border border-line bg-surface-raised px-3 py-2 text-sm hover:border-moss/40 dark:border-ink-700 dark:bg-ink-850"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-sunken text-moss dark:bg-ink-800">
        <Icon size={16} />
      </span>
      <span className="min-w-0">
        <span className="block truncate font-medium text-slate-800 dark:text-slate-100">{att.name}</span>
        {att.size && <span className="block text-[11px] text-slate-400">{att.size}</span>}
      </span>
      {att.kind !== "link" && (
        <Download size={15} className="ml-2 text-slate-400" />
      )}
    </a>
  );
}
