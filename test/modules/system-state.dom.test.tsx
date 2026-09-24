import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  notFound,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  LoaderFailedState,
  NotFound,
  NotFoundState,
  RouteFailed,
  loaderFailureMessage,
} from "../../src/modules/auth/components/SystemState";

/**
 * Round 22's system states: X1 not found, X2 loader failed. *"Signed in,
 * the shell stays so the tab bar is the way out. Signed out, Auth's rule:
 * no bars."*
 */
async function renderAt(element: ReactElement, path = "/somewhere") {
  const rootRoute = createRootRoute({ component: () => element });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

const tabBar = () => document.querySelector("[data-slot='tab-bar']");
const state = () =>
  document.querySelector<HTMLElement>("[data-part='system-state']");

describe("X1 · not found", () => {
  it("keeps the shell signed in, lights no tab, and points at the feed", async () => {
    await renderAt(<NotFoundState signedIn />);

    expect(tabBar()).not.toBeNull();
    expect(document.querySelector("[data-slot='tab-indicator']")).toBeNull();
    expect(state()).toHaveAttribute("data-state", "not-found");
    expect(
      screen.getByRole("heading", { level: 1, name: "Nothing here" }),
    ).toBeVisible();
    // One sentence for gone and private, so a 404 never confirms a hidden
    // entry exists.
    expect(
      screen.getByText(
        "This page doesn't exist, or it's an entry its runner has made private.",
      ),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Go to your feed" })).toHaveAttribute(
      "href",
      "/feed",
    );
    // No brackets on the headline: this is neither a wait nor a next step.
    expect(state()).not.toHaveTextContent("[");
  });

  it("has no bars at all signed out, and the way out is Log in", async () => {
    await renderAt(<NotFoundState signedIn={false} />);

    expect(tabBar()).toBeNull();
    expect(document.querySelector("[data-slot='top-bar']")).toBeNull();
    expect(document.querySelector("[data-slot='landing-bar']")).toBeNull();
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute(
      "href",
      "/auth/login",
    );
    expect(screen.queryByRole("link", { name: "Go to your feed" })).toBeNull();
    expect(screen.getByText("404")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("X2 · loader failed", () => {
  it("is the band, opening Didn't load, in the shell when signed in", async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    await renderAt(
      <LoaderFailedState
        signedIn
        message="Our end failed. Your closet is fine."
        onRetry={onRetry}
      />,
    );

    expect(tabBar()).not.toBeNull();
    const band = state()?.querySelector("[data-part='failure-band']");
    expect(band).toHaveTextContent("Didn't load");
    expect(band).toHaveTextContent("Our end failed. Your closet is fine.");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("has no bars signed out", async () => {
    await renderAt(
      <LoaderFailedState
        signedIn={false}
        message="Our end failed."
        onRetry={vi.fn()}
      />,
    );
    expect(tabBar()).toBeNull();
    expect(state()).toHaveAttribute("data-state", "loader-failed");
  });
});

describe("loaderFailureMessage", () => {
  it("names the tab's own thing as still fine, where it has one", () => {
    expect(loaderFailureMessage(new Error("x"), "Closet")).toBe(
      "Our end failed. Your closet is fine.",
    );
    expect(loaderFailureMessage(new Error("x"), "Feed")).toBe(
      "Our end failed. Your feed is fine.",
    );
  });

  it("says only the cause anywhere else", () => {
    expect(loaderFailureMessage(new Error("x"), "Call")).toBe("Our end failed.");
    expect(loaderFailureMessage(new Error("x"), undefined)).toBe(
      "Our end failed.",
    );
  });

  it("says the connection dropped for a network failure, whatever the tab", () => {
    expect(loaderFailureMessage(new TypeError("fetch"), "Closet")).toBe(
      "Your connection dropped.",
    );
  });
});

/**
 * The two router-facing components, inside a router whose root loader
 * says who is signed in — the way `__root.tsx` hands it down.
 */
async function routedApp({
  signedIn,
  path,
  failWith,
}: Readonly<{ signedIn: boolean | "unloaded"; path: string; failWith?: Error }>) {
  const rootRoute = createRootRoute({
    loader: () => (signedIn === "unloaded" ? undefined : { signedIn }),
    component: () => <Outlet />,
  });
  const closet = createRoute({
    getParentRoute: () => rootRoute,
    path: "/closet",
    loader: () => {
      if (failWith) throw failWith;
    },
    component: () => <p>the closet</p>,
  });
  const gone = createRoute({
    getParentRoute: () => rootRoute,
    path: "/runs/gone",
    loader: () => {
      // The route's own "nothing here", as run detail throws it.
      notFound({ throw: true });
    },
    component: () => <p>unreachable</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([closet, gone]),
    history: createMemoryHistory({ initialEntries: [path] }),
    defaultNotFoundComponent: NotFound,
    defaultErrorComponent: RouteFailed,
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return router;
}

describe("the router's defaults", () => {
  it("frame an unknown path by the root's signed-in answer", async () => {
    await routedApp({ signedIn: true, path: "/nowhere" });
    await screen.findByText("Nothing here");
    expect(tabBar()).not.toBeNull();
  });

  it("show a stranger no bars", async () => {
    await routedApp({ signedIn: false, path: "/nowhere" });
    await screen.findByText("Nothing here");
    expect(tabBar()).toBeNull();
  });

  it("treat a root that has not answered as signed out", async () => {
    await routedApp({ signedIn: "unloaded", path: "/nowhere" });
    await screen.findByText("Nothing here");
    expect(tabBar()).toBeNull();
  });

  it("catch a route's own not-found the same way", async () => {
    await routedApp({ signedIn: true, path: "/runs/gone" });
    expect(await screen.findByText("Nothing here")).toBeVisible();
    expect(screen.queryByText("unreachable")).toBeNull();
  });

  it("put a loader's failure in the band, naming the lit tab's thing, and retry it", async () => {
    const user = userEvent.setup();
    const router = await routedApp({
      signedIn: true,
      path: "/closet",
      failWith: new Error("D1 down"),
    });
    await screen.findByText("Our end failed. Your closet is fine.");
    // The tab stays lit: the route did.
    expect(document.querySelector("[data-slot='tab-indicator']")).not.toBeNull();

    const invalidate = vi.spyOn(router, "invalidate");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledTimes(1);
    });
  });

  it("say only the cause off a tab", async () => {
    const rootRoute = createRootRoute({
      loader: () => ({ signedIn: true }),
      component: () => <Outlet />,
    });
    const elsewhere = createRoute({
      getParentRoute: () => rootRoute,
      path: "/onboarding/name",
      loader: () => {
        throw new Error("down");
      },
      component: () => <p>unreachable</p>,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([elsewhere]),
      history: createMemoryHistory({ initialEntries: ["/onboarding/name"] }),
      defaultErrorComponent: RouteFailed,
    });
    await router.load();
    render(<RouterProvider router={router} />);
    expect(await screen.findByText("Our end failed.")).toBeVisible();
  });
});
