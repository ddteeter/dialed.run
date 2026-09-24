import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import type { FeedItem } from "../../src/modules/feed/feed";

/**
 * The routes the feed's screens link to, stubbed, so a typed `<Link>`
 * resolves and a click can be followed.
 */
export async function renderFeedScreen(element: ReactElement, at = "/") {
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
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      indexRoute,
      stub("/feed", "The feed"),
      stub("/feed/entry/$entryId", "An entry"),
      stub("/feed/search", "Search"),
      stub("/feed/verdict/$entryId", "Verdict"),
      stub("/feed/u/$userId", "A profile"),
      stub("/call", "The Call"),
      stub("/runs/backlog", "Backlog"),
      stub("/runs/new", "Log a run"),
      stub("/settings", "Settings"),
    ]),
    history: createMemoryHistory({ initialEntries: [at] }),
  });
  await router.load();
  return { router, ...render(<RouterProvider router={router} />) };
}

export const NOW = 1_755_000_000;

export function feedItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    entryId: "01ENTRY",
    userId: "01USER",
    authorDisplayName: undefined,
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
    ...overrides,
  };
}

export const MILES = { temp: "f", distance: "mi" } as const;
