import { createRouter as createTanStackRouter } from "@tanstack/react-router";

import { viewTransitionTypesFor } from "./lib/nav-types";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    /**
     * Design round 12: the router reads the navigation type from the edge.
     *
     * **`types` takes a function**, which is the whole reason the NAV table
     * can live in one file instead of being spread across 60 `Link` sites.
     * `defaultViewTransition` is itself static, but what it holds is
     * evaluated per navigation against the locations — and returning
     * `false` skips the transition entirely, which is how `cut` is spelled.
     *
     * `__TSR_index` is the history index, so "is this a back navigation" is
     * read rather than inferred from the table. It is what lets `push`
     * reverse on the way out ("Back feels like back because the screen
     * physically goes back") without a second set of rows.
     *
     * Everything above is glue; the decision is `src/lib/nav-types.ts`,
     * which imports nothing and is tested directly. This file cannot be
     * imported by a test — `routeTree.gen` pulls every route, and a route
     * pulls server functions — so nothing that branches belongs here.
     */
    defaultViewTransition: { types: viewTransitionTypesFor },
  });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
