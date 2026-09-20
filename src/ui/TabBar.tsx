import { Link, useRouterState, type LinkProps } from "@tanstack/react-router";
import type { JSX } from "react";

import { Mono } from "./Mono";

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
}: Readonly<{
  to: NonNullable<LinkProps["to"]>;
  label: string;
  active: boolean;
}>): JSX.Element {
  return (
    <li className="text-center">
      <Link
        to={to}
        aria-current={active ? "page" : undefined}
        className={active ? ACTIVE_LABEL_CLASS : RESTING_LABEL_CLASS}
      >
        <Mono step="sm">{label}</Mono>
      </Link>
    </li>
  );
}

/**
 * The label's colour is the half of the tab switch that is not the
 * indicator, and it flips on the same 90ms.
 *
 * Inactive labels are `--muted` rather than a lighter grey: the
 * Accessibility Contract's round note moved them from #9A9A90 to #6E6E64
 * because "2.8:1 was fine for a glyph, not for the word beside it".
 */
const ACTIVE_LABEL_CLASS = "tab-label text-ink no-underline";
const RESTING_LABEL_CLASS = "tab-label text-muted no-underline";

/**
 * The five tabs, in order. The indicator's position is this array's index,
 * so the order here is load-bearing twice over.
 */
const TABS = [
  { to: "/feed", label: "Feed" },
  { to: "/closet", label: "Closet" },
  { to: "/runs/new", label: "+ Add" },
  { to: "/call", label: "Call" },
  // Points at lane 104's own profile route until a `you/` lane exists.
  { to: "/feed/me", label: "You" },
] as const satisfies readonly {
  to: NonNullable<LinkProps["to"]>;
  label: string;
}[];

/**
 * Which tab owns a path, or `undefined` when none does.
 *
 * **Longest match wins, and that is the whole reason this is a function.**
 * `/feed/me` is a descendant of `/feed`, so a first-match-wins scan lights
 * the Feed tab while the runner is looking at their own profile. It is
 * also why the test for it is a route and not a prefix: `/feed` must not
 * claim `/feedback`, were one ever to exist.
 *
 * A path no tab owns — `/runs/manual`, `/onboarding/name` — returns
 * `undefined` and the indicator is not rendered at all. A tab bar that
 * kept pointing at wherever you were last is a tab bar that lies.
 */
export function activeTabIndex(
  pathname: string,
  tabs: readonly { to: string }[] = TABS,
): number | undefined {
  let found: number | undefined;
  let matched = 0;
  for (const [index, tab] of tabs.entries()) {
    if (pathname !== tab.to && !pathname.startsWith(`${tab.to}/`)) continue;
    if (tab.to.length < matched) continue;
    found = index;
    matched = tab.to.length;
  }
  return found;
}

/**
 * The five-tab shell footer (docs/product.md §Navigation). Every tab points
 * at its own route; D-31 is what is left here, and wants its own change
 * because a tab bar growing glyphs is worth a demo of its own.
 *
 * **The active indicator slides; the content does not transition**
 * (design/motion.js, "Tab switch"). The tabs are an equal-width grid
 * rather than a `justify-between` row precisely so the indicator can be
 * one fifth of the track and travel in whole multiples of itself — the
 * alternative is measuring each label at runtime, which is a resize
 * observer for a move that is 90ms long.
 */
export function TabBar() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const active = activeTabIndex(pathname);

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 border-t border-hairline bg-ground px-5 pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="relative m-0 grid list-none grid-cols-5 p-0 py-4">
        {TABS.map((tab, index) => (
          <Tab
            key={tab.to}
            to={tab.to}
            label={tab.label}
            active={index === active}
          />
        ))}
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
