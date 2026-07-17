// Tiny event bus so any page (or the keyboard) can open/toggle/close the
// global command palette without prop-drilling through the route tree.
// Mirrors the Hermes dock bus (lib/hermesBus.ts) for a consistent pattern.
export const PALETTE_OPEN_EVENT = "wjw:open-palette";
export const PALETTE_TOGGLE_EVENT = "wjw:toggle-palette";
export const PALETTE_CLOSE_EVENT = "wjw:close-palette";

export function openPalette() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(PALETTE_OPEN_EVENT));
}
export function togglePalette() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(PALETTE_TOGGLE_EVENT));
}
export function closePalette() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(PALETTE_CLOSE_EVENT));
}
