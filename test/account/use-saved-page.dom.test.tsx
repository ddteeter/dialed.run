import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

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

describe("useSavedPage", () => {
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
});
