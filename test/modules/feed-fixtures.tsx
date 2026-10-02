import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { vi } from "vitest";
import { renderToString } from "react-dom/server";

import type { FeedItem } from "../../src/modules/feed/feed";
import type { ControlGate, ControlGuard } from "../../src/ui";

/**
 * The routes the feed's screens link to, stubbed, so a typed `<Link>`
 * resolves and a click can be followed.
 */
function feedRouter(element: ReactElement, at: string) {
  const rootRoute = createRootRoute();
  const stub = (path: string, text: string) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      component: () => <p>{text}</p>,
    });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => element,
  });
  return createRouter({
    routeTree: rootRoute.addChildren([
      indexRoute,
      stub("/feed", "The feed"),
      stub("/feed/entry/$entryId", "An entry"),
      stub("/feed/search", "Search"),
      stub("/feed/verdict/$entryId", "Verdict"),
      stub("/feed/u/$userId", "A profile"),
      stub("/@{$handle}", "A profile by handle"),
      stub("/call", "The Call"),
      stub("/runs/backlog", "Backlog"),
      stub("/runs/new", "Log a run"),
      stub("/settings", "Settings"),
    ]),
    history: createMemoryHistory({ initialEntries: [at] }),
  });
}

export async function renderFeedScreen(element: ReactElement, at = "/") {
  const router = feedRouter(element, at);
  await router.load();
  return { router, ...render(<RouterProvider router={router} />) };
}

/**
 * The screen's first paint, as the server sends it — before any effect
 * runs. The one place a region's starting text can be read: a child that
 * reports into it on mount has overwritten it by the time a DOM test looks.
 */
export async function firstPaintOf(element: ReactElement): Promise<string> {
  const router = feedRouter(element, "/");
  await router.load();
  return renderToString(<RouterProvider router={router} />);
}

export const NOW = 1_755_000_000;

export function feedItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    entryId: "01ENTRY",
    userId: "01USER",
    authorUsername: undefined,
    runId: "01RUN",
    runTitle: "Evening run",
    distanceM: 8047,
    durationS: 1830,
    startedAt: NOW - 2 * 3600,
    indoor: false,
    verdict: undefined,
    caption: undefined,
    createdAt: NOW,
    itemNames: [],
    photoKeys: [],
    tags: [],
    usefulCount: 0,
    viewerHasReacted: false,
    conditions: undefined,
    underReview: false,
    ...overrides,
  };
}

export const MILES = { temp: "f", distance: "mi" } as const;

/**
 * The confirm sheet's gate, for the screens whose Useful and report wait
 * on a confirmed address (seam 7): a stand-in for `account`'s sheet — a
 * dialog named as the real one is, present only while open, saying which
 * control opened it — and Not now closes it. It opens only on the
 * server's refusal, so a screen whose server says yes never shows it.
 */
export const CONFIRM_FIRST: ControlGate<"useful" | "report"> = {
  sheet: ({ open, trigger }, onClose) =>
    open ? (
      <div role="dialog" aria-label="Confirm your email first">
        <p>Opened from {trigger}</p>
        <button type="button" onClick={onClose}>
          Not now
        </button>
      </div>
    ) : undefined,
};

/**
The guard a card or a button takes from its screen, for tests that only need one.
*/
export const ANY_GUARD: ControlGuard<"useful"> = { ask: vi.fn() };
