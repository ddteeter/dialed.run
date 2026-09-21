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
    expect(
      document.querySelector("[data-slot='notification-bell']"),
    ).toBeNull();
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
  it("is a labelled nav of four links and one launcher", async () => {
    // Each tab is a separately typed <Link> so TanStack can check the path
    // literal against the generated route tree. A shared `to: string`
    // would compile and silently stop being checked.
    //
    // Four, not five: the Accessibility Contract's round-12 row makes
    // `+ Add` a `<button aria-haspopup="dialog">` — "a launcher cannot be
    // where you are", so it is not an anchor that could claim to be.
    await renderWithRouter(<TabBar />);

    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav).toBeInTheDocument();

    const launcher = screen.getByRole("button", { name: "Add" });
    expect(launcher).toHaveAttribute("aria-haspopup", "dialog");
    // Never current, in any state: there is no page for it to be on.
    expect(launcher).not.toHaveAttribute("aria-current");
    // The seat is still one of five, so the bar still announces "2 of 5".
    expect(nav.querySelectorAll("li")).toHaveLength(5);

    const destinations = Object.fromEntries(
      screen
        .getAllByRole("link")
        .map((link) => [link.textContent, link.getAttribute("href")]),
    );
    // Same rationale as Bracketed: the tabs are shouted in CSS and their
    // text nodes stay in normal case, so a reader announces "Feed" rather
    // than spelling it out.
    // The treatment moved inside the link, onto `Mono`: one `step="sm"`
    // now carries family, size, line-height, tracking and case together,
    // which is what stopped the tab bar spelling its own 11px/0.08em.
    for (const link of screen.getAllByRole("link")) {
      const label = link.firstElementChild;
      expect(label).toHaveClass("font-mono");
      expect(label).toHaveClass("text-mono-sm");
      expect(label).toHaveClass("uppercase");
    }

    expect(destinations).toStrictEqual({
      Feed: "/feed",
      Closet: "/closet",
      // Call landed with lane 105 — this pin is what made the repoint a
      // deliberate edit rather than a silent one. You is still a
      // placeholder at lane 104's profile route until a `you/` lane exists.
      Call: "/call",
      You: "/feed/me",
    });
  });
});
