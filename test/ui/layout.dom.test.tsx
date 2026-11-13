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
import { PhoneBell } from "../../src/ui/PhoneBell";
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

  it("renders the caller's bell in the top bar, and in the screen's own seat on the phone", async () => {
    await renderWithRouter(
      <Layout bell={<button type="button">Notifications</button>}>
        <div data-testid="first-row">
          <h1>Page</h1>
          <PhoneBell />
        </div>
      </Layout>,
    );

    // Two, and deliberately: the bell sits in the top bar at width and at
    // the end of the screen's first row below it (Design 169.1). Those are
    // two elements because `data-ground="ink"` cannot be applied per
    // breakpoint. Only one is ever displayed.
    const bells = screen.getAllByRole("button", { name: "Notifications" });
    expect(
      bells.map((bell) => bell.closest("[data-slot='top-bar']") !== null),
    ).toStrictEqual([true, false]);
    const seat = bells[1]?.closest("[data-slot='notification-bell']");
    expect(seat?.parentElement).toBe(screen.getByTestId("first-row"));
    // 44 target 12 from the edge: half into the 24 gutter.
    expect(seat).toHaveClass("-mr-3", "shrink-0", "wide:hidden");
  });

  it("draws no row of its own for the bell: the empty row is gone (Design 169.1)", async () => {
    await renderWithRouter(
      <Layout bell={<button type="button">Notifications</button>}>page</Layout>,
    );
    // Only the top bar's: no screen seat was placed, so nothing else.
    expect(
      screen.getAllByRole("button", { name: "Notifications" }),
    ).toHaveLength(1);
    expect(
      document.querySelector("[data-slot='notification-bell']"),
    ).toBeNull();
    expect(screen.getAllByRole("banner")).toStrictEqual([
      document.querySelector("[data-slot='top-bar']"),
    ]);
  });

  it("seats nothing when the layout has no bell", async () => {
    await renderWithRouter(
      <Layout>
        <PhoneBell />
      </Layout>,
    );
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
});

describe("TabBar", () => {
  it("is a labelled nav of four links and one launcher", async () => {
    // Each tab is a separately typed <Link> so TanStack can check the path
    // literal against the generated route tree. A shared `to: string`
    // would compile and silently stop being checked.
    //
    // Four, not five: the Accessibility Contract's round-12 row makes
    // `+ Add` a `<button>` — "a launcher cannot be where you are", so it
    // is not an anchor that could claim to be. Round 52 #161 took its
    // `aria-haspopup`: it navigates, and no dialog opens.
    await renderWithRouter(<TabBar />);

    // The contract's own name for the bar, which is what a screen reader
    // announces on reaching it.
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(nav).toBeInTheDocument();

    const launcher = screen.getByRole("button", { name: "Add a run" });
    expect(launcher).not.toHaveAttribute("aria-haspopup");
    // Never current, in any state: there is no page for it to be on.
    expect(launcher).not.toHaveAttribute("aria-current");
    // A <button> shrinks to its text where an <a> fills its grid seat, so
    // without the full width `+ Add` sat at the left of its fifth of the bar
    // while the four links centred in theirs (owner, 2026-11-06).
    expect(launcher).toHaveClass("w-full");
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
