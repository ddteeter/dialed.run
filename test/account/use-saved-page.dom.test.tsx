import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useSavedPage } from "../../src/modules/account/use-saved-page";

/**
 * The terms prompt's page name (D-102), from the navigation's history
 * state and never the URL (SA-L13, design 230).
 */
function Shows() {
  const page = useSavedPage();
  return <p data-testid="page">{page ?? "(none)"}</p>;
}

async function prompt(
  open: (router: ReturnType<typeof makeRouter>) => Promise<void>,
): Promise<ReturnType<typeof makeRouter>> {
  const router = makeRouter();
  await router.load();
  render(<RouterProvider router={router} />);
  await open(router);
  return router;
}

function makeRouter() {
  const rootRoute = createRootRoute();
  const terms = createRoute({
    getParentRoute: () => rootRoute,
    path: "/account/terms",
    component: Shows,
  });
  const home = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <p>home</p>,
  });
  return createRouter({
    routeTree: rootRoute.addChildren([home, terms]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
}

/**
 * What the root's `useHydrated` leaves on a page that has hydrated: a
 * screen reached after it is a client navigation.
 */
function stampHydrated(): void {
  document.documentElement.dataset.hydrated = "true";
}

afterEach(() => {
  delete document.documentElement.dataset.hydrated;
});

describe("useSavedPage", () => {
  beforeEach(stampHydrated);

  it("is the name the app's own navigation carried", async () => {
    await prompt((router) =>
      router.navigate({
        to: "/account/terms",
        state: { savedPage: " Edit Harrier " },
      }),
    );
    expect(await screen.findByTestId("page")).toHaveTextContent("Edit Harrier");
  });

  it("is nothing from a link's search, whatever it says", async () => {
    await prompt((router) =>
      router.navigate({ href: "/account/terms?save=the%20closet" }),
    );
    expect(await screen.findByTestId("page")).toHaveTextContent("(none)");
  });

  it("is nothing past a heading's worth of words", async () => {
    await prompt((router) =>
      router.navigate({
        to: "/account/terms",
        state: { savedPage: "h".repeat(101) },
      }),
    );
    expect(await screen.findByTestId("page")).toHaveTextContent("(none)");
  });

  it("is nothing before hydration, as the server drew it", async () => {
    delete document.documentElement.dataset.hydrated;
    const router = makeRouter();
    await router.navigate({
      to: "/account/terms",
      state: { savedPage: "Edit Harrier" },
    });
    await router.load();
    expect(renderToString(<RouterProvider router={router} />)).toContain(
      "(none)",
    );
  });

  it("stays nothing on a server-rendered load, after hydration too (R60·60b)", async () => {
    // The prompt is the first screen: nothing had hydrated when it
    // mounted, so the line is never drawn, rather than moving in later.
    delete document.documentElement.dataset.hydrated;
    const router = makeRouter();
    await router.navigate({
      to: "/account/terms",
      state: { savedPage: "Edit Harrier" },
    });
    await router.load();
    render(<RouterProvider router={router} />);
    expect(await screen.findByTestId("page")).toHaveTextContent("(none)");

    stampHydrated();
    await router.invalidate();

    expect(screen.getByTestId("page")).toHaveTextContent("(none)");
  });

  it("is in the first render of a client navigation (R60·60b)", async () => {
    const router = makeRouter();
    await router.navigate({
      to: "/account/terms",
      state: { savedPage: "Edit Harrier" },
    });
    await router.load();
    // A render with no effects run: what the first render draws.
    expect(renderToString(<RouterProvider router={router} />)).toContain(
      "Edit Harrier",
    );
  });
});
