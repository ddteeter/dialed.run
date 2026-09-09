import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { Layout } from "../../src/ui/Layout";
import { TabBar } from "../../src/ui/TabBar";

/**
 * The page shell, mounted.
 *
 * `Layout`'s only behaviour is an effect — it stamps
 * `html[data-hydrated="true"]`, which every e2e spec waits on before it
 * drives a controlled input. In the workers pool there is no document to
 * stamp, so the one line the whole browser suite depends on had no test.
 */

/**
TabBar renders typed <Link>s, which need router context.
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

describe("Layout", () => {
  it("stamps the hydration signal every e2e spec waits on", async () => {
    delete document.documentElement.dataset.hydrated;
    await renderWithRouter(<Layout>page</Layout>);

    await waitFor(() => {
      expect(document.documentElement.dataset.hydrated).toBe("true");
    });
  });

  it("renders the caller's bell when it is given one", async () => {
    await renderWithRouter(
      <Layout bell={<button type="button">Notifications</button>}>page</Layout>,
    );

    expect(
      screen.getByRole("button", { name: "Notifications" }),
    ).toBeInTheDocument();
    // The placeholder gives way rather than sitting beside it.
    expect(document.querySelector("[data-slot='notification-bell']")).toBeNull();
  });

  it("holds the slot open with an inert placeholder when it is not", async () => {
    // `??`, not `&&`: without a bell the header still needs its right-hand
    // slot, or the page reflows the moment notifications land. The
    // placeholder is hidden from assistive tech because it is furniture.
    await renderWithRouter(<Layout>page</Layout>);

    const placeholder = document.querySelector(
      "[data-slot='notification-bell']",
    );
    expect(placeholder).not.toBeNull();
    expect(placeholder).toHaveAttribute("aria-hidden", "true");
  });
});

describe("TabBar", () => {
  it("is a labelled nav with the five tabs, pointing where they point", async () => {
    // Each tab is a separately typed <Link> so TanStack can check the path
    // literal against the generated route tree. A shared `to: string`
    // would compile and silently stop being checked.
    await renderWithRouter(<TabBar />);

    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav).toBeInTheDocument();

    const destinations = Object.fromEntries(
      screen
        .getAllByRole("link")
        .map((link) => [link.textContent, link.getAttribute("href")]),
    );
    // Same rationale as Bracketed: the tabs are shouted in CSS and their
    // text nodes stay in normal case, so a reader announces "Feed" rather
    // than spelling it out.
    for (const link of screen.getAllByRole("link")) {
      expect(link).toHaveClass("uppercase");
      expect(link).toHaveClass("font-mono");
    }

    expect(destinations).toStrictEqual({
      Feed: "/feed",
      Closet: "/closet",
      "+ Add": "/runs/new",
      // Placeholder targets: lane 105 repoints Call at /call, and You gets
      // its own lane later. Pinned so the repoint is a deliberate edit.
      Call: "/",
      You: "/feed/me",
    });
  });
});
