import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

import type { RunConditions, RunSummary } from "../../src/modules/runs/service";

/**
 * The runs screens' shared fixtures: a run as the list and run detail
 * receive it, its conditions, and a router with every place those screens
 * link to, so an href can be read and a navigation can land.
 */

/**
 * 2026-08-29 11:04 UTC — 6:04 AM in Chicago, the boards' own morning.
 */
export const SAT_MORNING = Math.floor(Date.UTC(2026, 7, 29, 11, 4) / 1000);

export const RUN_ID = "01HQA00000000000000000000R";

export function runConditions(
  overrides: Partial<RunConditions> = {},
): RunConditions {
  return {
    tempC: 5,
    feelsLikeC: 2,
    humidity: 88,
    windKph: 14.5,
    precipMm: 1,
    condition: "Light rain",
    timeZone: "America/Chicago",
    isSetByYou: false,
    ...overrides,
  };
}

/**
A band chosen in R2b: 10–15 °C, stored at its middle, "55°F · SET BY YOU".
*/
export const SET_BY_YOU = runConditions({ tempC: 12.5, isSetByYou: true });

export function runSummary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    id: RUN_ID,
    source: "file",
    startedAt: SAT_MORNING,
    durationS: 3098,
    distanceM: 9978,
    indoor: false,
    weatherStatus: "attached",
    canSetConditions: false,
    conditions: runConditions(),
    entryId: undefined,
    hasVerdict: false,
    ...overrides,
  };
}

const PLACES = [
  "/runs",
  "/runs/new",
  "/runs/strava",
  "/runs/$runId",
  "/feed/attach/$runId",
  "/feed/verdict/$entryId",
  "/feed/entry/$entryId",
] as const;

/**
 * Renders `element` at `/` inside a router that knows every screen these
 * components link to. Each stand-in names its path, so a test can see
 * where a navigation went.
 */
export async function renderWithRouter(element: ReactElement) {
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => element,
  });
  const others = PLACES.map((path) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      component: () => <p>at {path}</p>,
    }),
  );
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, ...others]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return { router, ...render(<RouterProvider router={router} />) };
}
