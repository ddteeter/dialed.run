import { useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { TabBar } from "./TabBar";
import { TABS, bar, tabToLight, useSlowRoute } from "./tabs";
import { LandingBar, TopBar, type LandingAction } from "./TopBar";
import { useHydrated } from "./use-hydrated";

/**
 * Page shell: chalk surface, ink type, and the bar — which one depends on
 * the width.
 *
 * Below `BREAKPOINT.wide` it is the phone's five-tab footer with the
 * notification bell in a header row above the content. From 720 up the
 * Desktop Contract replaces both with one top bar (DS1), and bend 4 is
 * what happens to the row this header used to be: *"at width there is one
 * top bar; per-screen headers drop to a plain TYPE.title above the
 * content"*. The heading itself is `Page`'s and does not move, so no
 * screen gains or loses an `h1` — the ink header block the contract
 * describes was never built here, and a bell row is not a heading.
 *
 * **Both bars are in the DOM at once and one is hidden by CSS**, which is
 * the one structural compromise in this lane. `data-ground="ink"` is an
 * attribute, and the twelve roles it redefines are inherited, so it cannot
 * be applied per-breakpoint — the inverted bar has to be its own element.
 * The bell is therefore rendered in both seats and the launcher exists
 * twice (with two different words, per round 15). What is *not* duplicated
 * is the table both bars read: `./tabs` owns the destinations and their
 * order, so "same four, same order" is structural rather than remembered.
 *
 * `bell` is supplied by the caller (lane 102's NotificationBell) rather
 * than imported here — ui/ is foundation and may not import from modules/
 * (CLAUDE.md architecture rules; enforced by dependency-cruiser).
 */
export function Layout({
  children,
  bell,
}: Readonly<{ children: ReactNode; bell?: ReactNode }>) {
  useHydrated();

  return (
    <div className="flex min-h-dvh flex-col bg-ground text-ink">
      <TopBar bell={bell} />
      <header className="flex items-center justify-end px-5 pt-4 wide:hidden">
        {bell ?? <div aria-hidden="true" data-slot="notification-bell" />}
      </header>
      {/* DS4: "content max 1180 inside SPACE[6] gutters" — the page
          measure lives here rather than on each screen, so a reflowed
          column left-aligns inside the page rather than against the
          window edge on a wide monitor. The gutters are the screen's own
          padding; this only bounds it.

          The tab bar is fixed to the bottom edge and needs the content to
          clear it; the top bar is in the flow and does not. */}
      <div className="mx-auto w-full max-w-page flex-1 pb-24 wide:pb-0">
        {children}
      </div>
      <TabBar />
      <SlowRouteStatus />
    </div>
  );
}

/**
 * X3's one announcement: *"Screen reader: the status region says 'Loading
 * Closet.' once, at 300ms."*
 *
 * Here rather than in either bar, because both bars are mounted at once
 * and a region in each would say it twice. The label is the lit seat's —
 * the destination's, since the router moves the location before the
 * screen arrives — and a destination no tab owns says nothing, which is
 * the same "never lie about where you are" rule the indicator keeps.
 */
function SlowRouteStatus() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const { isSlow } = useSlowRoute();
  const lit = tabToLight(pathname, bar.lastOnTab);
  const label = TABS.find((_tab, index) => index === lit)?.label;

  return (
    <span role="status" className="sr-only">
      {isSlow && label !== undefined ? `Loading ${label}.` : ""}
    </span>
  );
}

/**
 * The shell a signed-out page wears: the landing bar from 720 up, nothing
 * below it, and **never the tab bar** (round 22, Auth §2: *"Every tab is a
 * signed-in place; showing them to someone signed out is five links to
 * the log-in page"*). Auth, the landing page, and a signed-out 404 all
 * wear this.
 *
 * Paper all the way up — *"auth is not a product screen, so it doesn't
 * get the ink header"* — so there is no bell seat either.
 */
export function SignedOutLayout({
  action,
  children,
}: Readonly<{ action: LandingAction; children: ReactNode }>) {
  useHydrated();

  return (
    <div className="flex min-h-dvh flex-col bg-ground text-ink">
      <LandingBar action={action} />
      <div className="mx-auto w-full max-w-page flex-1">{children}</div>
    </div>
  );
}
