import { useRef } from "react";

/**
 * Focus that goes back to the control a step was opened from, once the
 * step has closed (Accessibility Contract: a closed surface returns focus
 * to its trigger, never to `<body>`).
 *
 * `ref` goes on the trigger; `restore()` is called by whatever closes the
 * step. If the trigger is on screen, it takes focus there and then; if it
 * is not — the CSAM question's Cancel brings back a decision bar drawn
 * afresh — it takes focus the moment it mounts.
 *
 * **Focus follows the trigger across a remount.** The control that opened
 * a step is often not one node for long: a photo well's input is a
 * different element once the well turns from empty to filled, and again
 * while its photo uploads — each a commit or an upload after the step
 * closed. An element that leaves the page while it holds focus drops it on
 * `<body>`; here, its replacement takes it instead. One that had lost
 * focus by then — the runner has moved on — takes nothing, so nothing is
 * ever stolen back.
 *
 * Nothing on first paint: arriving on a screen moves nothing.
 *
 * A plain callback, re-made every render, rather than a memoised one: React
 * then hands it the element on every commit, detaching first, so "did the
 * element hold focus as it went?" is asked at the one moment it can be —
 * while the element is still in the page — and asking it again of an
 * element that stayed is harmless.
 */
export function useReturnFocus(): {
  ref: (node: HTMLElement | null) => void;
  restore: () => void;
} {
  const current = useRef<HTMLElement | null>(null);
  const owesFocus = useRef(false);
  return {
    ref: (node) => {
      if (node === null) {
        // Detaching, with the element still in the page: whatever comes
        // next is owed focus exactly if this one held it.
        owesFocus.current =
          globalThis.document.activeElement === current.current;
      } else if (owesFocus.current) {
        node.focus();
      }
      current.current = node;
    },
    restore: () => {
      current.current?.focus();
      owesFocus.current = true;
    },
  };
}
