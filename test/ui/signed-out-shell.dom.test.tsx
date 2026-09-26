import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { Layout, SignedOutLayout } from "../../src/ui/Layout";
import { SLOW_ROUTE_MS, activeTabIndex } from "../../src/ui/tabs";
import { LandingBar } from "../../src/ui/TopBar";

/**
 * The signed-out shell (round 21 item 23, round 22 Auth §2) and the slow
 * route (round 22, X3).
 *
 * happy-dom lays nothing out, so "hidden below 720" is asserted as the
 * class that does it and Playwright's conformance specs check the widths.
 */
async function renderAt(element: ReactElement, pathname = "/") {
  const rootRoute = createRootRoute({ component: () => element });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [pathname] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

const landingBar = () => document.querySelector("[data-slot='landing-bar']");

describe("LandingBar", () => {
  it("exists only from 720 up, on paper, with a hairline foot", async () => {
    await renderAt(<LandingBar action="none" />);

    // "Below 720, no bar." Hidden by CSS rather than unmounted, like the
    // product bar, so SSR and the first client render agree at any width.
    expect(landingBar()).toHaveClass("hidden", "wide:block");
    expect(landingBar()).toHaveClass("border-b", "border-hairline", "bg-ground");
    // Not an inverted block: "paper all the way up".
    expect(landingBar()).not.toHaveAttribute("data-ground");
    expect(landingBar()).toHaveAttribute("data-part", "top-bar");
  });

  it("links the plain wordmark home and offers nothing on an auth page", async () => {
    await renderAt(<LandingBar action="none" />);

    const home = screen.getByRole("link", { name: "dialed.run home" });
    expect(home).toHaveAttribute("href", "/");
    expect(home).toHaveAttribute("data-part", "wordmark");
    // The plain lockup: no brackets on this bar.
    expect(home).toHaveTextContent(/^dialed\.run$/u);
    // "'Log in' on the log-in page would point at itself."
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(document.querySelector("[data-part='bar-actions']")).toBeNull();
  });

  it("offers a hairline Log in when signed out", async () => {
    await renderAt(<LandingBar action="log-in" />);

    const action = screen.getByRole("link", { name: "Log in" });
    expect(action).toHaveAttribute("href", "/auth/login");
    expect(action).toHaveAttribute("data-part", "bar-actions");
    // Secondary: a hairline pill, never filled and never pink.
    expect(action).toHaveClass("border", "border-hairline", "rounded-pill");
    expect(action).not.toHaveClass("bg-ink");
    expect(action).not.toHaveClass("bg-action");
  });

  it("offers an ink Your closet when signed in", async () => {
    await renderAt(<LandingBar action="closet" />);

    const action = screen.getByRole("link", { name: "Your closet" });
    expect(action).toHaveAttribute("href", "/closet");
    expect(action).toHaveAttribute("data-part", "bar-actions");
    expect(action).toHaveClass("bg-ink", "text-ground", "rounded-pill");
    expect(action).not.toHaveClass("border-hairline");
  });
});

describe("SignedOutLayout", () => {
  it("wears the landing bar and never the tab bar or the product bar", async () => {
    delete document.documentElement.dataset.hydrated;
    await renderAt(<SignedOutLayout action="log-in">page</SignedOutLayout>);

    expect(landingBar()).not.toBeNull();
    expect(screen.getByRole("link", { name: "Log in" })).toBeInTheDocument();
    // "A signed-out page never shows the tab bar."
    expect(document.querySelector("[data-slot='tab-bar']")).toBeNull();
    expect(document.querySelector("[data-slot='top-bar']")).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.getByText("page")).toBeInTheDocument();
    // The e2e suite waits on this stamp before driving any input.
    await waitFor(() => {
      expect(document.documentElement.dataset.hydrated).toBe("true");
    });
  });
});

describe("the You tab holds settings and the blocked list", () => {
  it("lights You on the settings index, its sub-pages and the blocked list", () => {
    for (const path of [
      "/onboarding/settings",
      "/onboarding/settings/units",
      "/safety/blocked",
      "/feed/me",
    ]) {
      expect([path, activeTabIndex(path)]).toEqual([path, 4]);
    }
  });

  it("does not claim the rest of onboarding or safety", () => {
    for (const path of ["/onboarding/calibrate", "/safety/review"]) {
      expect([path, activeTabIndex(path)]).toEqual([path, undefined]);
    }
  });

  it("lets the deepest owner win across a tab's own path and its extras", () => {
    const tabs = [
      { to: "/a", also: ["/b/c"] },
      { to: "/b" },
    ];
    // `/b/c` is deeper than `/b`, so the first tab keeps it even though
    // the second tab comes later and also owns the path.
    expect(activeTabIndex("/b/c/d", tabs)).toBe(0);
    expect(activeTabIndex("/b/x", tabs)).toBe(1);
    expect(activeTabIndex("/a", tabs)).toBe(0);
  });
});

/**
 * A two-route app whose Closet loader waits on the test, so the load can
 * be held open for as long as a case needs.
 */
async function slowApp() {
  const closetLoad = Promise.withResolvers<undefined>();
  const rootRoute = createRootRoute({
    component: () => (
      <Layout>
        <Outlet />
      </Layout>
    ),
  });
  const feed = createRoute({
    getParentRoute: () => rootRoute,
    path: "/feed",
    component: () => <p>the feed</p>,
  });
  const closet = createRoute({
    getParentRoute: () => rootRoute,
    path: "/closet",
    loader: () => closetLoad.promise,
    component: () => <p>the closet</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([feed, closet]),
    history: createMemoryHistory({ initialEntries: ["/feed"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  await screen.findByText("the feed");
  return {
    router,
    release: () => {
      closetLoad.resolve(undefined);
    },
  };
}

const status = () => screen.getByRole("status");
const breathing = () => document.querySelectorAll(".breathe");

describe("a slow route (X3)", () => {
  it("keeps the old screen and says nothing for the first 300ms", async () => {
    const app = await slowApp();
    const started = Date.now();
    void app.router.navigate({ to: "/closet" });

    await waitFor(() => {
      expect(app.router.state.isLoading).toBe(true);
    });
    // Nothing before the threshold: no brackets, no announcement.
    expect(Date.now() - started).toBeLessThan(SLOW_ROUTE_MS);
    expect(breathing()).toHaveLength(0);
    expect(status()).toHaveTextContent(/^$/u);
    expect(screen.getByText("the feed")).toBeInTheDocument();

    await act(async () => {
      app.release();
      await Promise.resolve();
    });
    await screen.findByText("the closet");
  });

  it("breathes the destination's label and announces it once, after 300ms", async () => {
    const app = await slowApp();
    void app.router.navigate({ to: "/closet" });

    await waitFor(
      () => {
        expect(status()).toHaveTextContent("Loading Closet.");
      },
      { timeout: SLOW_ROUTE_MS * 4 },
    );
    // Both bars' Closet label, and only Closet's: four brackets, two per
    // bar, and the old screen still up underneath.
    expect(breathing()).toHaveLength(4);
    for (const bracket of breathing()) {
      expect(bracket.closest("a")).toHaveAttribute("href", "/closet");
    }
    expect(screen.getByText("the feed")).toBeInTheDocument();

    // Settled: the brackets go and the region empties.
    await act(async () => {
      app.release();
      await Promise.resolve();
    });
    await screen.findByText("the closet");
    expect(breathing()).toHaveLength(0);
    expect(status()).toHaveTextContent(/^$/u);
  });

  it("never breathes while nothing is loading", async () => {
    await slowApp();
    expect(breathing()).toHaveLength(0);
    // Idle for longer than the threshold: a wait is only ever a load's.
    await new Promise((resolve) => {
      globalThis.setTimeout(resolve, SLOW_ROUTE_MS * 2);
    });
    expect(breathing()).toHaveLength(0);
    expect(status()).toHaveTextContent(/^$/u);
  });

  it("forgets a quick load's timer, so the next idle moment stays still", async () => {
    const rootRoute = createRootRoute({
      component: () => (
        <Layout>
          <Outlet />
        </Layout>
      ),
    });
    const feed = createRoute({
      getParentRoute: () => rootRoute,
      path: "/feed",
      component: () => <p>the feed</p>,
    });
    const closet = createRoute({
      getParentRoute: () => rootRoute,
      path: "/closet",
      // Quick: settles well inside the threshold.
      loader: () =>
        new Promise<void>((resolve) => {
          globalThis.setTimeout(resolve, SLOW_ROUTE_MS / 6);
        }),
      component: () => <p>the closet</p>,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([feed, closet]),
      history: createMemoryHistory({ initialEntries: ["/feed"] }),
    });
    await router.load();
    render(<RouterProvider router={router} />);
    await screen.findByText("the feed");

    await act(async () => {
      await router.navigate({ to: "/closet" });
    });
    await screen.findByText("the closet");
    // Past the point the quick load's timer would have fired.
    await new Promise((resolve) => {
      globalThis.setTimeout(resolve, SLOW_ROUTE_MS * 2);
    });
    expect(breathing()).toHaveLength(0);
    expect(status()).toHaveTextContent(/^$/u);
  });

  it("says nothing for a slow destination no tab owns", async () => {
    const rootRoute = createRootRoute({
      component: () => (
        <Layout>
          <Outlet />
        </Layout>
      ),
    });
    const start = createRoute({
      getParentRoute: () => rootRoute,
      path: "/feed",
      component: () => <p>start</p>,
    });
    const elsewhere = createRoute({
      getParentRoute: () => rootRoute,
      path: "/onboarding/name",
      loader: () =>
        new Promise<void>(() => {
          // Never settles: the case is what shows while it waits.
        }),
      component: () => <p>elsewhere</p>,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([start, elsewhere]),
      history: createMemoryHistory({ initialEntries: ["/feed"] }),
    });
    await router.load();
    render(<RouterProvider router={router} />);
    await screen.findByText("start");
    void router.navigate({ to: "/onboarding/name" });

    await new Promise((resolve) => {
      globalThis.setTimeout(resolve, SLOW_ROUTE_MS * 2);
    });
    expect(router.state.isLoading).toBe(true);
    expect(screen.getByRole("status")).toHaveTextContent(/^$/u);
    expect(breathing()).toHaveLength(0);
  });
});
