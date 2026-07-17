// Tiny event bus so any page (e.g. the board toolbar) can open the Hermes
// assistant dock without prop-drilling through the route tree.
export const HERMES_TOGGLE_EVENT = "wjw:toggle-hermes";
export const HERMES_OPEN_EVENT = "wjw:open-hermes";

export function openHermes() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(HERMES_OPEN_EVENT));
}
export function toggleHermes() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(HERMES_TOGGLE_EVENT));
}
