import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { StravaCallbackResult } from "../../src/modules/runs/components/StravaCallbackResult";

/**
 * Two small screens that were markup inside a route, so neither fork could
 * be reached by a test.
 */
async function renderWithRouter(element: ReactElement) {
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => element,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

describe("StravaCallbackResult", () => {
  it("says connected, and what that means", async () => {
    await renderWithRouter(<StravaCallbackResult result={{ ok: true }} />);

    expect(screen.getByRole("heading", { name: "Connected" })).toBeVisible();
    expect(screen.getByText(/remind you to log your kit/)).toBeVisible();
  });

  it("shows the reason it did not connect, rather than a generic failure", async () => {
    // The reason comes from `stravaCallbackOutcome` — "cancelled" and
    // "expired" are different things to have happened.
    await renderWithRouter(
      <StravaCallbackResult
        result={{ ok: false, reason: "Strava connection was cancelled." }}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Not connected" }),
    ).toBeVisible();
    expect(screen.getByText("Strava connection was cancelled.")).toBeVisible();
  });

  it("offers a way back either way", async () => {
    await renderWithRouter(<StravaCallbackResult result={{ ok: true }} />);
    expect(
      screen.getByRole("link", { name: "Back to Strava settings" }),
    ).toHaveAttribute("href", "/runs/strava");
  });
});
