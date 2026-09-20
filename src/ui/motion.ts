/**
 * dialed.run motion tokens for JS-driven animation — ported from
 * design/motion.js (the Motion Doctrine; design/ is the source of truth).
 * CSS-driven motion uses the custom properties in motion.css instead.
 * Never type a raw ms value or cubic-bezier into a screen: if a move
 * needs a duration that is not here, it is the wrong move.
 */

/**
Milliseconds. Nothing in the product animates longer than `reveal`.
*/
export const DURATION = {
  /**
  state flips: toggle, checkbox, tab active, row press
  */
  instant: 90,
  /**
  small element enter/exit, toast, digit tick
  */
  quick: 140,
  /**
  sheets, drawers, step transitions, list reflow
  */
  move: 220,
  /**
  the recommendation payoff and the verdict commit. Only these.
  */
  reveal: 320,
} as const;

/**
Three curves. There is no fourth.
*/
export const EASING = {
  /**
  default: fast off the line, dead stop
  */
  snap: "cubic-bezier(0.2, 0, 0, 1)",
  /**
  accelerate away — only for things leaving the screen
  */
  exit: "cubic-bezier(0.4, 0, 1, 1)",
  /**
  slightly held at the end — the bracket clicking into alignment
  */
  align: "cubic-bezier(0.6, 0, 0.2, 1)",
} as const;

/**
Enter/exit travel in px. Anything larger is a container, not an element.
*/
export const TRAVEL = { element: 24, frame: 8 } as const;

/**
Stagger only where the order IS the information (dressing order).
*/
export const STAGGER = { step: 30, maxItems: 4 } as const;

/**
 * Whether this viewer has asked for reduced motion.
 *
 * The CSS half of the doctrine reads the media query directly (see
 * `motion.css`); this is for the two moves that cannot, because they are
 * measured at runtime — the closet's reflow and anything else that hands
 * keyframes to `Element.animate`. A move that skipped this would keep
 * travelling for a viewer who asked it not to, and nothing would say so.
 *
 * `matchMedia` is absent on the server and in some test environments, and
 * absent means "no preference expressed" rather than "reduce".
 */
export function shouldReduceMotion(): boolean {
  // `typeof`, not `?.`: the DOM types declare `matchMedia` as always
  // present, so an optional chain here is a branch the compiler insists
  // cannot be taken and the linter agrees with it. The server and some
  // test environments disagree.
  if (typeof globalThis.matchMedia !== "function") return false;
  return globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
