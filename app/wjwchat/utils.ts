import type { User } from "./types";
import { users, CURRENT_USER_ID } from "./seed";

export function getUser(id: string): User {
  return users.find((u) => u.id === id) || users[0];
}

export function isSelf(id: string): boolean {
  return id === CURRENT_USER_ID;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Relative, human time: "just now", "5m", "3h", "2d", else date.
export function formatTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function formatFull(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Date separator label: "Today", "Yesterday", or full date.
export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(d, today)) return "Today";
  if (same(d, yest)) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

// Escape HTML for safe inline rendering of user text.
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Render message text to safe HTML with: mentions, links, code, line breaks.
export function renderText(text: string): string {
  let html = esc(text);
  // code spans `like this`
  html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
  // links
  html = html.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" class="msg-link">$1</a>'
  );
  // @mentions
  html = html.replace(/@([a-z0-9_]+)/gi, (_, h) => `<span class="mention">@${h}</span>`);
  // line breaks
  html = html.replace(/\n/g, "<br/>");
  return html;
}

// Highlight a search query inside already-safe html (wraps matches in <mark>).
export function highlight(text: string, query: string): string {
  const html = renderText(text);
  if (!query) return html;
  const q = query.trim();
  if (!q) return html;
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  return html.replace(re, "<mark>$1</mark>");
}
