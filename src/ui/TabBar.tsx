import {
  useNavigate,
  useRouterState,
  type LinkProps,
} from "@tanstack/react-router";
import { useEffect, type JSX } from "react";

import { Mono } from "./Mono";
import { TabItem, TabLabel } from "./TabItem";
import { TABS, bar, tabToLight, useSlowRoute } from "./tabs";

/**
 * The bar's one launcher: `+ Add`.
 *
 * **A button, never a link** (Accessibility Contract, round 12) — "a
 * launcher cannot be where you are". An anchor announces a destination
 * and can be marked current; this opens the log flow *over* wherever the
 * runner already is. It is the reason the contract's "five `<a
 * aria-current>`" now reads as four links and one button.
 *
 * It navigates, because the flow is three routes rather than a
 * `<dialog>` — `rise` is what makes that read as a layer
 * (`src/lib/nav-types.ts`). So it carries no `aria-haspopup` (round 52
 * #161): the attribute promised a dialog that never opened, and the
 * contract's row now reads "Add a run, button".
 *
 * **The wide bar has its own**, saying "Log a run" (round 15). Same
 * control, same role, a different word because the seat is a different
 * size — see `TopBar`.
 */
const LAUNCHER_NAME = "Add a run";

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
        // The glyph is decoration and the word starts the name. Without
        // this the button announces as "plus Add"; with the bare word it
        // was "Add" here and "Log a run" in the top bar, two names for one
        // control. "Add a run" keeps the visible word first (WCAG 2.5.3)
        // and says what is added.
        aria-label={LAUNCHER_NAME}
        // `w-full`: a button shrinks to its text, where the links' anchors
        // fill their seat, so without it `+ Add` sits left of its column.
        className={`tab-label target ${RESTING_LABEL_CLASS} w-full bg-transparent p-0`}
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
  "flex items-center justify-center text-ink no-underline";
const RESTING_LABEL_CLASS =
  "flex items-center justify-center text-label no-underline";

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
            <TabItem
              key={tab.to}
              to={tab.to}
              active={index === active}
              itemClass="text-center"
              activeClass={ACTIVE_LABEL_CLASS}
              restingClass={RESTING_LABEL_CLASS}
            >
              {/* The equal-width grid means there is no width to hold while
                  waiting; the breathing brackets are here for the label
                  (round 22, X3: over 300ms, old screen stays up). */}
              <Mono step="sm">
                <TabLabel
                  label={tab.label}
                  waiting={index === active && isSlow}
                />
              </Mono>
            </TabItem>
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
