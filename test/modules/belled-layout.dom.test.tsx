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

describe("BelledLayout", () => {
  it("puts the bell in the layout's slot, carrying the count it was given", async () => {
    await renderWithRouter(
      <BelledLayout unreadCount={3}>page</BelledLayout>,
    );

    // The count reaches the bell rather than being dropped on the way:
    // bracket notation, per docs/product.md §Brand. `textContent` because
    // `Bracketed` renders the brackets as their own text nodes.
    const bell = screen.getByRole("link", { name: "Notifications" });
    expect(bell.textContent).toContain("[3]");
  });

  it("still renders the bell when there is nothing unread", async () => {
    // The bell is the link to /notifications whether or not it has a
    // number on it — a route with a zero count must not lose its way back.
    await renderWithRouter(
      <BelledLayout unreadCount={0}>page</BelledLayout>,
    );

    const bell = screen.getByRole("link", { name: "Notifications" });
    expect(bell.textContent).not.toContain("[0]");
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
