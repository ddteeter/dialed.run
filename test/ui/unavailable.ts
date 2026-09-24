import { expect } from "vitest";

/**
 * Rule 07 · **never disabled**, as one assertion.
 *
 * *"`aria-disabled="true"` plus a handler guard. True `disabled` drops the
 * element from the tab order and hides why."* So "unavailable" has three
 * parts and all three matter:
 *
 * 1. it is **not** the `disabled` attribute — the whole point;
 * 2. it says `aria-disabled`, so a reader is told it is unavailable
 *    rather than simply never meeting it;
 * 3. it is still focusable, which is what lets the runner reach it, read
 *    the label that explains why, and try.
 *
 * Nine controls moved from `disabled` to this, and nine tests said
 * `expect(button).toBeDisabled()` — a passing test holding the old
 * behaviour in place, which is the shape D-82 was. Shared rather than
 * written out nine times so the third part cannot be the one somebody
 * forgets: `toBeDisabled()` alone is satisfied by an element that has been
 * dropped from the tab order, and that is the failure, not the fix.
 */
function expectUnavailable(control: HTMLElement): void {
  expect(control).not.toBeDisabled();
  expect(control).toHaveAttribute("aria-disabled", "true");
  expect(control).not.toHaveAttribute("tabindex", "-1");
}

/**
 * Unavailable *because work is in flight*, which is the other half of
 * design's round-13 table: `aria-busy` alongside, and no dimming.
 */
export function expectBusy(control: HTMLElement): void {
  expectUnavailable(control);
  expect(control).toHaveAttribute("aria-busy", "true");
}

/**
 * Available: no claim of either kind.
 *
 * `aria-busy="false"` and an absent `aria-busy` are not the same thing to
 * every reader, and `inFlight()` deliberately emits neither attribute at
 * rest — so this asserts absence rather than a negative value.
 */
export function expectAvailable(control: HTMLElement): void {
  expect(control).not.toBeDisabled();
  expect(control).not.toHaveAttribute("aria-disabled");
  expect(control).not.toHaveAttribute("aria-busy");
}
