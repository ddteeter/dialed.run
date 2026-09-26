import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { BelledLayout } from "../../src/modules/notifications/components/BelledLayout";

/**
 * `Layout` with the bell already in its slot — the wiring seven routes
 * each wrote out by hand.
 *
 * `Layout` renders the node in two seats since task 115 (the top bar at
 * width, the per-screen header below it), so the assertions here read
 * both. Which one is displayed is a width question and therefore
 * Playwright's; what this file is about is that what the route loaded
 * reaches the bell at all.
 */

/**
Both the bell and TabBar render typed <Link>s, which need router context.
*/
async function renderWithRouter(element: ReactElement) {
  const rootRoute = createRootRoute({ component: () => element });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

function bells(): HTMLElement[] {
  return screen.getAllByRole("link", { name: /^Notifications/u });
}

describe("BelledLayout", () => {
  it("carries the waiting count to the bell in both seats", async () => {
    await renderWithRouter(
      <BelledLayout unreadCount={1} verdictsWaiting={3}>
        page
      </BelledLayout>,
    );

    expect(bells()).toHaveLength(2);
    for (const bell of bells()) expect(bell).toHaveTextContent(/^3$/u);
  });

  it("gives a route that only knows its unread count the dot", async () => {
    // The routes still loading `unreadNotificationCountFn` keep working.
    await renderWithRouter(<BelledLayout unreadCount={3}>page</BelledLayout>);

    for (const bell of bells()) {
      expect(bell).toHaveAttribute("data-state", "dot");
    }
  });

  it("still renders the bell when there is nothing new", async () => {
    // The bell is the link to /notifications whatever it shows — a route
    // with nothing new must not lose its way back.
    await renderWithRouter(<BelledLayout unreadCount={0}>page</BelledLayout>);

    for (const bell of bells()) {
      expect(bell).toHaveAttribute("href", "/notifications");
    }
  });

  it("renders the page it wraps", async () => {
    await renderWithRouter(
      <BelledLayout unreadCount={1}>
        <p>the page</p>
      </BelledLayout>,
    );

    expect(screen.getByText("the page")).toBeInTheDocument();
  });
});
