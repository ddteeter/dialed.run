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
      {/* No `aria-current` here: `Link` sets `aria-current="page"` on the
          route it is on, and a prop passed here was silently overwritten
          by it — which is exactly how a mutant that emptied the string
          survived a test asserting the attribute. What this owns is the
          colour, which `Link`'s own active handling does not touch. */}
      <Link
        to={to}
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
 * The five bar entries, in order. The indicator's position is this array's
 * index, so the order here is load-bearing twice over.
 *
 * **`+ Add` is a launcher, not a tab** (design round 12, `NAV`'s
 * `+ Add (bar launcher) -> Log a run` row): logging a run is a task laid
 * on top of wherever you were, not a place in the bar you travel to. So
 * the indicator never travels to it.
 *
 * The rest of that row is not built here. It says the tab *beneath* stays
 * selected, which means remembering the last tab you were actually on —
 * `/runs/new` does not say — and it is one behaviour with the `rise` the
 * same row specifies. Both belong to the navigation lane; D-80 carries
 * them. Until then no tab is lit during the flow, which is what the bar
 * already does on `/runs/manual`: incomplete rather than wrong.
 */
const TABS = [
  { to: "/feed", label: "Feed" },
  { to: "/closet", label: "Closet" },
  { to: "/runs/new", label: "+ Add", launcher: true },
  { to: "/call", label: "Call" },
  // Points at lane 104's own profile route until a `you/` lane exists.
  { to: "/feed/me", label: "You" },
] as const satisfies readonly {
  to: NonNullable<LinkProps["to"]>;
  label: string;
  launcher?: boolean;
}[];

/**
 * Which tab owns a path, or `undefined` when none does.
 *
 * **The deepest owner wins, and that is the whole reason this is a
 * function.** `/feed/me` is a descendant of `/feed`, so a first-match-wins
 * scan lights the Feed tab while the runner is looking at their own
 * profile.
 *
 * A path no tab owns — `/runs/manual`, `/onboarding/name` — returns
 * `undefined` and the indicator is not rendered at all. A tab bar that
 * kept pointing at wherever you were last is a tab bar that lies.
 */
/**
 * Whether `route` owns `pathname` — it is the path, or an ancestor of it.
 *
 * A route and not a prefix: `/feed` must not claim `/feedback`, were one
 * ever to exist.
 */
function isOwnerOf(route: string, pathname: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

export function activeTabIndex(
  pathname: string,
  tabs: readonly { to: string; launcher?: boolean }[] = TABS,
): number | undefined {
  let found: number | undefined;
  // `""` owns every path — "/feed".startsWith("/") — so the first tab that
  // matches always wins the seat, and after that a tab only takes it from
  // the incumbent by being *inside* it.
  //
  // Depth rather than string length, which is what this compared first.
  // The two agree on every input, because two distinct routes of equal
  // length cannot both own one pathname — one would have to be a prefix
  // of the other. That made `<` and `<=` indistinguishable: an equivalent
  // mutant with no test that could ever exist. Asking the question the
  // predicate already answers leaves nothing to suppress.
  let deepest = "";
  for (const [index, tab] of tabs.entries()) {
    // A launcher owns no path. Standing on `/runs/new` is being inside a
    // flow, not being on a tab, so nothing in the bar claims the seat.
    if (tab.launcher === true) continue;
    if (!isOwnerOf(tab.to, pathname)) continue;
    if (!isOwnerOf(deepest, tab.to)) continue;
    found = index;
    deepest = tab.to;
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
