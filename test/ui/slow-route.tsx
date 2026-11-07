import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { vi } from "vitest";

import { SLOW_ROUTE_MS } from "../../src/ui/tabs";

/**
 * A screen whose links lead to a page that never arrives, for X3's
 * in-screen links (round 22; round 47 #122): the screen at `at`, and
 * `slowPath`'s loader pending for good.
 *
 * The caller installs fake timers first, faking only the timers so the
 * router's own clock reads stay real.
 */
export async function renderWithSlowRoute(
  element: ReactElement,
  { at, slowPath }: Readonly<{ at: string; slowPath: string }>,
): Promise<void> {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const screen = createRoute({
    getParentRoute: () => rootRoute,
    path: at,
    component: () => element,
  });
  const slow = createRoute({
    getParentRoute: () => rootRoute,
    path: slowPath,
    loader: () =>
      new Promise<never>(() => {
        // A page that never arrives.
      }),
    component: () => <p>unreachable</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([screen, slow]),
    history: createMemoryHistory({ initialEntries: [at] }),
  });
  await act(async () => {
    await router.load();
  });
  render(<RouterProvider router={router} />);
}

/**
Presses a link and lets its page run to the slow threshold.
*/
export async function tapAndWaitSlow(link: HTMLElement): Promise<void> {
  fireEvent.click(link);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(SLOW_ROUTE_MS);
  });
}

/**
Only the timers: what X3's tests fake.
*/
export const ONLY_TIMERS: Parameters<typeof vi.useFakeTimers>[0] = {
  toFake: ["setTimeout", "clearTimeout"],
};
