import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import { SessionActions } from "../../src/modules/auth/components/SessionActions";

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

const nothing = () => Promise.resolve();

describe("SessionActions", () => {
  it("offers a signed-out visitor both ways in", async () => {
    await renderWithRouter(
      <SessionActions email={undefined} signOut={nothing} />,
    );

    expect(screen.getByRole("link", { name: "Sign up" })).toHaveAttribute(
      "href",
      "/auth/signup",
    );
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute(
      "href",
      "/auth/login",
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows a signed-in visitor who they are, in mono", async () => {
    // Mono is the tell that a value came from the system rather than being
    // typed as prose.
    await renderWithRouter(
      <SessionActions email="runner@example.com" signOut={nothing} />,
    );

    expect(screen.getByText("runner@example.com")).toHaveClass("font-mono");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("signs them out when asked", async () => {
    const user = userEvent.setup();
    const signOut = vi.fn(() => Promise.resolve());
    await renderWithRouter(
      <SessionActions email="runner@example.com" signOut={signOut} />,
    );

    await user.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => {
      expect(signOut).toHaveBeenCalledTimes(1);
    });
  });
});
