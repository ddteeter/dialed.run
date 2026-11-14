import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";

import { Layout, SignedOutLayout } from "../../src/ui/Layout";
import { SLOW_ROUTE_MS, activeTabIndex } from "../../src/ui/tabs";
import { SignedOutFrame } from "../../src/ui/SignedOutFrame";

/**
 * The signed-out shell (round 21 item 23, round 22 Auth §2) and the slow
 * route (round 22, X3).
 *
 * happy-dom lays nothing out, so "hidden below 720" is asserted as the
 * class that does it and Playwright's conformance specs check the widths.
 */
async function routerAt(element: ReactElement, path = "/") {
  const rootRoute = createRootRoute({ component: () => element });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return router;
}

async function renderAt(element: ReactElement, path = "/") {
  await routerAt(element, path);
}

const landingBar = () => document.querySelector("[data-slot='landing-bar']");
const barLink = (name: string) =>
  landingBar()?.querySelector<HTMLAnchorElement>(
    `a[href="${CSS.escape(name)}"]`,
  );

describe("SignedOutFrame (Round 55 · 176)", () => {
  it("draws its bar at every width, on paper, 56 then 64, with its edge on the page measure", async () => {
    await renderAt(<SignedOutFrame>page</SignedOutFrame>);

    // Shown at every width now: no `hidden`.
    expect(landingBar()).not.toHaveClass("hidden");
    expect(landingBar()?.tagName).toBe("HEADER");
    expect(landingBar()).toHaveClass(
      "border-b",
      "border-hairline",
      "bg-ground",
      "px-5",
      "wide:px-6",
    );
    // Not an inverted block: "paper all the way up".
    expect(landingBar()).not.toHaveAttribute("data-ground");
    expect(landingBar()).toHaveAttribute("data-part", "top-bar");
    expect(landingBar()?.firstElementChild).toHaveClass(
      "h-14",
      "wide:h-16",
      "max-w-page",
      "mx-auto",
    );
  });

  it("links the pink-bracketed wordmark home at TYPE.title", async () => {
    await renderAt(<SignedOutFrame>page</SignedOutFrame>);

    const home = screen.getByRole("link", { name: "dialed.run home" });
    expect(home).toHaveAttribute("href", "/");
    expect(home).toHaveAttribute("data-part", "wordmark");
    expect(home).not.toHaveAttribute("data-reload-document");
    // Brackets drawn, then the name said once (`Wordmark`).
    expect(home).toHaveTextContent(/^\[dialed\.run\]dialed\.run$/u);
    expect(home.firstElementChild).toHaveClass("text-title");
  });

  it("offers Log in as text and, from 720, Request access as the pink pill", async () => {
    await renderAt(<SignedOutFrame>page</SignedOutFrame>);

    const logIn = screen.getByRole("link", { name: "Log in" });
    expect(logIn).toBe(barLink("/auth/login"));
    expect(logIn).toHaveClass("target", "font-bold", "text-ink", "text-body");
    expect(logIn).not.toHaveClass("rounded-pill");
    const ask = screen.getByRole("link", { name: "Request access" });
    expect(ask).toBe(barLink("/account/request-access"));
    expect(ask).toHaveClass(
      "target",
      "rounded-pill",
      "bg-action",
      "text-accent-ink",
      "hidden",
      "wide:inline-flex",
    );
    expect(logIn.parentElement).toHaveAttribute("data-part", "bar-actions");
    // Never the tab bar, the product bar or a nav.
    expect(document.querySelector("[data-slot='tab-bar']")).toBeNull();
    expect(document.querySelector("[data-slot='top-bar']")).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("drops Log in on the log-in page", async () => {
    await renderAt(<SignedOutFrame>page</SignedOutFrame>, "/auth/login");
    expect(barLink("/auth/login")).toBeNull();
    expect(barLink("/account/request-access")).not.toBeNull();
  });

  it("drops Request access on the request-access page", async () => {
    await renderAt(
      <SignedOutFrame>page</SignedOutFrame>,
      "/account/request-access",
    );
    expect(barLink("/account/request-access")).toBeNull();
    expect(barLink("/auth/login")).not.toBeNull();
  });

  it("puts a signed-in viewer's way into the app in their place", async () => {
    await renderAt(
      <SignedOutFrame intoApp={<span>Open in the app</span>}>
        page
      </SignedOutFrame>,
    );
    expect(landingBar()).toHaveTextContent("Open in the app");
    expect(barLink("/auth/login")).toBeNull();
    expect(barLink("/account/request-access")).toBeNull();
  });

  it("reloads the document on every way out when asked, and only then", async () => {
    const reloading = await routerAt(
      <SignedOutFrame reloadDocument>page</SignedOutFrame>,
    );
    for (const link of document.querySelectorAll("a")) {
      // A reloading link leaves the click to the browser: the router never
      // moves.
      fireEvent.click(link);
    }
    expect(reloading.state.location.pathname).toBe("/");
    cleanup();

    const routed = await routerAt(<SignedOutFrame>page</SignedOutFrame>);
    fireEvent.click(screen.getByRole("link", { name: "Log in" }));
    await waitFor(() => {
      expect(routed.state.location.pathname).toBe("/auth/login");
    });
  });

  it("ends with the five links: Privacy · Terms · Copyright · Open source, then the removal request", async () => {
    delete document.documentElement.dataset.hydrated;
    await renderAt(<SignedOutFrame>page</SignedOutFrame>);

    const footer = document.querySelector("[data-part='legal-footer']");
    expect(footer?.tagName).toBe("FOOTER");
    expect(footer).toHaveClass("border-t", "border-hairline", "text-small");
    expect(footer?.parentElement?.lastElementChild).toBe(footer);
    expect(screen.getByText("page")).toBeInTheDocument();
    const links = [...(footer?.querySelectorAll("a") ?? [])];
    expect(
      links.map((link) => [link.textContent, link.getAttribute("href")]),
    ).toEqual([
      ["Privacy", "/privacy"],
      ["Terms", "/terms"],
      ["Copyright", "/copyright"],
      ["Open source", "/open-source"],
      ["Report an intimate image", "/takedown"],
    ]);
    for (const link of links) {
      expect(link).toHaveClass("target", "text-quiet", "underline");
      // #632 A-03: the gaps are the links' own padding.
      expect(link).toHaveClass("inline-flex", "items-center", "px-2");
    }
    expect(links[0]?.parentElement).toHaveClass("-mx-2", "flex", "flex-wrap");
    // The e2e suite waits on this stamp before driving any input.
    await waitFor(() => {
      expect(document.documentElement.dataset.hydrated).toBe("true");
    });
  });
});

describe("SignedOutLayout", () => {
  it("wears the one frame around the page, on the page measure", async () => {
    await renderAt(<SignedOutLayout>page</SignedOutLayout>);
    expect(landingBar()).not.toBeNull();
    expect(screen.getByText("page")).toHaveClass("max-w-page", "flex-1");
    expect(document.querySelector("[data-part='legal-footer']")).not.toBeNull();
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
    const tabs = [{ to: "/a", also: ["/b/c"] }, { to: "/b" }];
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
