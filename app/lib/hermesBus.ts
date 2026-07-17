// Tiny event bus so any page (e.g. the board toolbar) can open the Hermes
// assistant dock without prop-drilling through the route tree. The optional
// context payload lets a page hand the dock read-only board context (visible
// cards / columns) that Hermes may reference for assist — it is DATA only and
// is never treated as instructions.
export const HERMES_TOGGLE_EVENT = "wjw:toggle-hermes";
export const HERMES_OPEN_EVENT = "wjw:open-hermes";
export const HERMES_CONTEXT_EVENT = "wjw:hermes-context";

export interface HermesContext {
  board?: { cardCount: number; columnCount: number; columns: { name: string; count: number }[] };
  hint?: string;
}

export function openHermes(context?: HermesContext) {
  if (typeof window !== "undefined") {
    if (context) window.dispatchEvent(new CustomEvent(HERMES_CONTEXT_EVENT, { detail: context }));
    window.dispatchEvent(new CustomEvent(HERMES_OPEN_EVENT));
  }
}
export function toggleHermes() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(HERMES_TOGGLE_EVENT));
}
