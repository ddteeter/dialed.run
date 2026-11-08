/**
 * The theme on this device (task 111, R48·133).
 *
 * T3: "One data-theme attribute on the root, values light | dark,
 * resolved from prefers-color-scheme unless a stored override exists."
 * `src/ui/tokens.css` does the resolving: no attribute follows the system
 * through a media query, and either value pins its ground. So the only
 * job here is the override — keep it on the device, put it on the root
 * before first paint, and take it off again.
 *
 * Kept in `localStorage` so the first paint of the next page is right
 * ("cached on the device so the first paint is right"). The account's own
 * value is the truth for a signed-in runner and replaces this one whenever
 * the root hears it (`ui/ThemeSync`); signed out it is always the system.
 *
 * Where storage is refused — a browser blocking site data — the attribute
 * still changes for this page and nothing is remembered, which is the
 * system default on the next one.
 */
import type { ThemeChoice } from "../contracts";

/**
The device's key. Changing it costs every device one first paint on the system.
*/
export const THEME_KEY = "dialed.run:theme";

/**
 * A classic inline script for the document's `<head>`, run while the head
 * is parsed and before the stylesheet paints anything (the root route puts
 * it there with the request's nonce, beside `ZOD_JITLESS_SCRIPT`). Only
 * the two pinned values are applied: anything else in storage, a value an
 * older build wrote or a hand edit, means following the system.
 */
export const THEME_HEAD_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

function remember(choice: ThemeChoice): void {
  try {
    if (choice === "system") globalThis.localStorage.removeItem(THEME_KEY);
    else globalThis.localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Refused storage: this page still changes; the next starts on the system.
  }
}

/**
 * Put a choice on the page at once and keep it on the device. A cut, not
 * a fade (T3: "the ground changes on the frame after the tap").
 */
export function applyTheme(
  choice: ThemeChoice,
  root: HTMLElement = document.documentElement,
): void {
  paint(root, choice);
  remember(choice);
}

function paint(root: HTMLElement, choice: ThemeChoice): void {
  if (choice === "system") delete root.dataset.theme;
  else root.dataset.theme = choice;
}

/**
 * Follow a theme another tab put on the device (#511). The browser sends
 * `storage` only to the other tabs of the origin and only on a real change,
 * so this paints and never writes back: nothing here can loop.
 *
 * Read as the head script reads it: `light` or `dark` pins, and anything
 * else means the system, including a removed key and a cleared storage
 * (`key` null). Returns the unsubscribe, for an effect's cleanup.
 */
export function followOtherTabs(
  root: HTMLElement = document.documentElement,
): () => void {
  const follow = (event: StorageEvent): void => {
    if (event.key !== THEME_KEY && event.key !== null) return;
    const value = event.newValue;
    paint(root, value === "light" || value === "dark" ? value : "system");
  };
  globalThis.addEventListener("storage", follow);
  return () => {
    globalThis.removeEventListener("storage", follow);
  };
}
