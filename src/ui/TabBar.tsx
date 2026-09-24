import {
  Link,
  useNavigate,
  useRouterState,
  type LinkProps,
} from "@tanstack/react-router";
import { useEffect, type JSX } from "react";

import { isLogFlowPath } from "../lib/nav-types";
import { PendingLabel } from "./form";
import { Mono } from "./Mono";
import { TABS, bar, tabToLight, useSlowRoute } from "./tabs";

/**
 * One tab.
 *
 * The five used to be written out, on the stated grounds that TanStack
 * checks route paths as literals and "widening them into a shared `string`
 * field would defeat that check". The first half is true and the second is
 * not: `LinkProps["to"]` is the generated union of real routes, not
 * `string`, so a typo here is still a type error — measured, with a made-up
 * path that tsc rejected through this exact prop.
 *
 * It is extracted now because the tab label became a `<Mono step="sm">`,
 * which pushed five identical four-line blocks past the clone gate. They
 * were a clone before that and simply short enough to hide.
 */
function Tab({
  to,
  label,
  active,
  held,
  waiting,
}: Readonly<{
  to: NonNullable<LinkProps["to"]>;
  label: string;
  active: boolean;
  /**
   * Lit because a flow is laid over this tab, rather than because the
   * runner is on it.
   */
  held: boolean;
  /**
   * This tab's screen has been loading for over 300ms (round 22, X3): the
   * label gains breathing brackets while the old screen stays up.
   */
  waiting: boolean;
}>): JSX.Element {
  return (
    <li className="text-center">
      {/* `aria-current` is `Link`'s on the route it is on: it spreads
          `"page"` last, so a prop passed for the *active* tab is silently
          overwritten — which is how a mutant that emptied the string once
          survived a test asserting the attribute. A held tab is not
          active, so nothing is spread over it and this is ours to set.

          `"true"` and never `"page"`, per the Accessibility Contract's
          round-12 row: the held tab is the current item in the set, and
          the runner is not on it. Claiming the page would send somebody
          to the wrong screen. */}
      <Link
        to={to}
        aria-current={held ? "true" : undefined}
        className={active ? ACTIVE_LABEL_CLASS : RESTING_LABEL_CLASS}
      >
        <Mono step="sm">
          {/* Only while waiting, so a resting tab's text is its label and
              nothing else. The equal-width grid means there is no width
              to hold; `PendingLabel` is here for the brackets. */}
          {waiting ? (
            <PendingLabel label={label} pendingLabel={label} pending />
          ) : (
            label
          )}
        </Mono>
      </Link>
    </li>
  );
}

/**
 * The bar's one launcher: `+ Add`.
 *
 * **A button, never a link** (Accessibility Contract, round 12) — "a
 * launcher cannot be where you are". An anchor announces a destination
 * and can be marked current; this opens the log flow *over* wherever the
 * runner already is, which is what `aria-haspopup="dialog"` says. It is
 * the reason the contract's "five `<a aria-current>`" now reads as four
 * links and one button.
 *
 * It still navigates, because the flow is three routes rather than a
 * `<dialog>` — `rise` is what makes that read as a layer
 * (`src/lib/nav-types.ts`). `haspopup` describes what the runner gets,
 * not which element implements it.
 *
 * **The wide bar has its own**, saying "Log a run" (round 15). Same
 * control, same role, a different word because the seat is a different
 * size — see `TopBar`.
 */
function Launcher({
  to,
  label,
}: Readonly<{
  to: NonNullable<LinkProps["to"]>;
  label: string;
}>): JSX.Element {
  const navigate = useNavigate();

  return (
    <li className="text-center">
      <button
        type="button"
        aria-haspopup="dialog"
        // The glyph is decoration and the word is the name. Without this
        // the button announces as "plus Add", and the contract's expected
        // reading is "Add, button, dialog".
        aria-label={label.replace("+ ", "")}
        className={`${RESTING_LABEL_CLASS} bg-transparent p-0`}
        onClick={() => {
          void navigate({ to });
        }}
      >
        <Mono step="sm">{label}</Mono>
      </button>
    </li>
  );
}

/**
 * The label's colour is the half of the tab switch that is not the
 * indicator, and it flips on the same 90ms.
 *
 * Inactive labels are `--label`, which is #6E6E64 — the value the
 * Accessibility Contract's Tab bar row has always named ("2.8:1 was fine
 * for a glyph, not for the word beside it"). This said `--muted` until
 * round 13, because #6E6E64 had no T1 row to point at, and #7A7A70 is
 * 3.90:1: the bar was asking for 4.6 and shipping 3.9 with a comment
 * claiming otherwise.
 */
const ACTIVE_LABEL_CLASS =
  "tab-label target flex items-center justify-center text-ink no-underline";
const RESTING_LABEL_CLASS =
  "tab-label target flex items-center justify-center text-label no-underline";

/**
 * The five-tab shell footer (docs/product.md §Navigation), **below 720
 * only**. From `BREAKPOINT.wide` up the Desktop Contract replaces it with
 * one top bar and `ui/TopBar` draws that instead — "same four
 * destinations, same order", which is `./tabs`'s job to guarantee rather
 * than this file's.
 *
 * **The active indicator slides; the content does not transition**
 * (design/motion.js, "Tab switch"). The tabs are an equal-width grid
 * rather than a `justify-between` row precisely so the indicator can be
 * one fifth of the track and travel in whole multiples of itself — the
 * alternative is measuring each label at runtime, which is a resize
 * observer for a move that is 90ms long.
 *
 * Round 15 confirmed that reading and split the doctrine's row in two:
 * sliding is *this* bar's, because equal columns make it free. The top
 * bar's four natural-width links carry a static underline.
 */
export function TabBar() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const active = tabToLight(pathname, bar.lastOnTab);
  const { isSlow } = useSlowRoute();

  useEffect(() => {
    // Only a real tab is worth recording. Nothing here needs to ask whether
    // the runner is inside the flow, and a guard that did would be
    // unkillable: inside it `active` *is* the remembered value, so writing
    // it back is the value it already had.
    if (active !== undefined) bar.lastOnTab = active;
  }, [active]);

  return (
    <nav
      // "Main", not "Primary": the Accessibility Contract's Tab bar row
      // names it, and a contract is the truth for values. The old name had
      // been here since the bar was written and was drift rather than a
      // decision (D-82).
      aria-label="Main"
      data-slot="tab-bar"
      data-part="tab-bar"
      className="fixed inset-x-0 bottom-0 border-t border-hairline bg-ground px-5 pb-[env(safe-area-inset-bottom)] wide:hidden"
    >
      {/* No `py-4` any more: the padding moved into each seat, where rule
          03 wants it ("pad the target, not the glyph"). The bar was 16 + 15
          + 16 = 47px tall with a 15px hit area inside it; it is 44px tall
          and all of it is the target. */}
      <ul className="relative m-0 grid list-none grid-cols-5 p-0">
        {TABS.map((tab, index) =>
          // `in`, not `tab.launcher`: `as const satisfies` keeps each entry
          // at its literal type, and only one of them has the field at all.
          "launcher" in tab ? (
            <Launcher key={tab.to} to={tab.to} label={tab.label} />
          ) : (
            <Tab
              key={tab.to}
              to={tab.to}
              label={tab.label}
              active={index === active}
              held={index === active && isLogFlowPath(pathname)}
              waiting={index === active && isSlow}
            />
          ),
        )}
        {active === undefined ? undefined : (
          // A list item, because a `<ul>` may hold nothing else — and
          // absolutely positioned, so it is out of the grid's flow and
          // the five columns are still five columns. The track is the
          // `<ul>`'s own box, which is why `px-5` sits on the `<nav>`:
          // `inset-x-0` here has to mean "the width of the five tabs".
          <li
            aria-hidden="true"
            data-slot="tab-indicator"
            className="pointer-events-none absolute inset-x-0 bottom-0"
          >
            <span
              className="tab-indicator block w-1/5 border-b-2 border-action"
              style={{ translate: `${String(active * 100)}% 0` }}
            />
          </li>
        )}
      </ul>
    </nav>
  );
}
