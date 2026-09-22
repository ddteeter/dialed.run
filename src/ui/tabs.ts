import type { LinkProps } from "@tanstack/react-router";

import { isLogFlowPath } from "../lib/nav-types";

/**
 * The bar's destinations, and which seat is lit.
 *
 * **One table, two bars.** Below `BREAKPOINT.wide` the five entries are
 * the phone's tab bar; from 720 up the four tabs are text links in
 * `TopBar` and the launcher is the pink pill beside them (Desktop
 * Contract DS1: *"the four tabs become four text links in the bar, same
 * order"*). Same order is the load-bearing half — a second array would
 * satisfy it on the day it was written and nothing would hold it there,
 * which is exactly the "rival truth" CLAUDE.md's §Derive, don't mirror
 * describes.
 *
 * It lives in its own file rather than in `TabBar.tsx` so the wide bar can
 * import the table without importing the phone bar's markup.
 */

/**
 * The five bar entries, in order. The indicator's position is this array's
 * index, so the order here is load-bearing twice over.
 *
 * **`+ Add` is a launcher, not a tab** (design round 12, `NAV`'s
 * `+ Add (bar launcher) -> Log a run` row): logging a run is a task laid
 * on top of wherever you were, not a place in the bar you travel to. So
 * the indicator never travels to it.
 */
export const TABS = [
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
 * The launcher's seat, so the wide bar can render the pill without typing
 * `/runs/new` a second time.
 *
 * A tuple index rather than a `.find()`, because a search returns
 * `| undefined` and the fallback arm would be a branch no input can take —
 * an unkillable mutant in place of a fact the type already knows. `TABS`
 * is `as const`, so this is the launcher's own literal type and
 * `test/ui/tabs.test.ts` pins that the seat this names really is the one
 * with the flag.
 */
export const LAUNCHER = TABS[2];

/**
 * Whether `route` owns `pathname` — it is the path, or an ancestor of it.
 *
 * A route and not a prefix: `/feed` must not claim `/feedback`, were one
 * ever to exist.
 */
function isOwnerOf(route: string, pathname: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`);
}

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
 * Which seat is lit: the tab that owns this path, or — inside the log flow
 * — the tab the runner was last actually on.
 *
 * **Inside the flow, path ownership is the wrong question.** Two of the
 * four steps live under `/feed` (`/feed/attach/…`, `/feed/verdict/…`), so
 * `activeTabIndex` lights Feed for them, which is Feed claiming a screen
 * the runner reached from Closet. The launcher row says the tab *beneath*
 * stays selected, and beneath means where they were.
 *
 * A pure function taking the memory as an argument rather than reading it,
 * so the case that matters most is reachable from a test: `undefined` is a
 * cold load straight into `/runs/new`, where the bar genuinely does not
 * know which tab the runner came from and says so by lighting none.
 */
export function tabToLight(
  pathname: string,
  lastOnTab: number | undefined,
): number | undefined {
  return isLogFlowPath(pathname) ? lastOnTab : activeTabIndex(pathname);
}

/**
 * The last tab the runner was actually standing on (D-80).
 *
 * Module scope and a one-field object, for the reasons `ui/FlowStep`'s
 * `flow.lastStep` gives and this shares: the bar is remounted by every
 * route, so component state cannot outlive a navigation, and assigning to
 * a bare module variable from inside a function is a lint error.
 *
 * **Written only from an effect**, which is what makes it safe on a server
 * that shares module scope between requests: effects do not run there, so
 * SSR always renders "no tab lit" and one runner's bar can never be
 * another's. The client's first render agrees, because a fresh document
 * starts with nothing here — a cold load of `/runs/new` genuinely does not
 * know which tab you came from, and says so by lighting none.
 *
 * **One memory, not one per bar.** Both bars are mounted at once and only
 * one is displayed, so a `bar` per component would leave the hidden one
 * remembering a different tab than the visible one — and which of the two
 * is which changes when the window is resized, with no remount to reset
 * it.
 */
export const bar: { lastOnTab?: number | undefined } = {};
