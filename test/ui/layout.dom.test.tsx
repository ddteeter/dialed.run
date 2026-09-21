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
 *
 * **Both bars are mounted and one is hidden by CSS** (task 115), so this
 * file sees two of several things that a runner only ever sees one of.
 * happy-dom applies no stylesheet, so which one is showing is Playwright's
 * question; what is asked here is that the pair exists and that nothing
 * has quietly become three.
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

  it("renders the caller's bell in both seats", async () => {
    await renderWithRouter(
      <Layout bell={<button type="button">Notifications</button>}>page</Layout>,
    );

    // Two, and deliberately: the bell sits in the top bar at width and in
    // the per-screen header below it (Desktop Contract bend 4), and those
    // are two elements because `data-ground="ink"` cannot be applied per
    // breakpoint — an attribute has no `wide:` and the roles it redefines
    // are inherited. Only one is ever displayed.
    const bells = screen.getAllByRole("button", { name: "Notifications" });
    // One in the bar and one in the header below it, in that DOM order —
    // asked of each bell rather than of the bar, so there is no element
    // that might not be there to assert against.
    expect(
      bells.map((bell) => bell.closest("[data-slot='top-bar']") !== null),
    ).toStrictEqual([true, false]);
    // The placeholder gives way rather than sitting beside it.
    expect(
      document.querySelector("[data-slot='notification-bell']"),
    ).toBeNull();
  });

  it("hides each bar at the width the other one owns", async () => {
    await renderWithRouter(<Layout>page</Layout>);

    // DS1: one bar at a time. `wide:hidden` on the phone bar and its
    // header, `hidden wide:block` on the top bar — so below 720 the
    // contract's bar is not merely off-screen, it is not laid out, and
    // above it neither is the footer.
    expect(document.querySelector("[data-slot='tab-bar']")).toHaveClass(
      "wide:hidden",
    );
    expect(document.querySelector("[data-slot='top-bar']")).toHaveClass(
      "hidden",
      "wide:block",
    );
  });

  it("bounds the content at the page measure", async () => {
    await renderWithRouter(<Layout>page</Layout>);

    // DS4: "content max 1180 inside SPACE[6] gutters". It lives on the
    // shell rather than on each screen so a reflowed column lines up
    // inside the page instead of against the window edge — and the
    // bottom padding that clears the fixed tab bar goes away with it.
    const content = screen.getByText("page");
    expect(content).toHaveClass("max-w-page", "pb-24", "wide:pb-0");
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

    // The contract's own name for the bar, which is what a screen reader
    // announces on reaching it.
    const nav = screen.getByRole("navigation", { name: "Main" });
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
