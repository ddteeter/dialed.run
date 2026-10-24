import { describe, expect, it } from "vitest";

import { withoutComments } from "./source-text";

/**
 * `/open-source` is a registered route (plan C9): the marketing site and
 * D-137 send people to `app.dialed.run/open-source`, so a page that stops
 * being registered is a dead link on another host, which nothing in this
 * repo would otherwise notice.
 *
 * Read as text: a route, and the route tree that imports every route,
 * cannot be imported by a test. The typed `Link`s to it (the signed-out
 * footer, Settings › About) are the compiler's half of the same check.
 */
const route = withoutComments(
  Object.values(
    import.meta.glob("../../src/routes/open-source.tsx", {
      query: "?raw",
      import: "default",
      eager: true,
    }),
  ).join(""),
);

const routeTree = Object.values(
  import.meta.glob("../../src/routeTree.gen.ts", {
    query: "?raw",
    import: "default",
    eager: true,
  }),
).join("");

describe("/open-source", () => {
  it("is a file route at /open-source, in the generated tree", () => {
    expect(route).toContain('createFileRoute("/open-source")');
    expect(routeTree).toMatch(/fullPath: '\/open-source'/u);
    expect(routeTree).toMatch(/'\/open-source': typeof OpenSourceRoute\b/u);
  });

  it("loads its page through the account module and draws it with the bell", () => {
    expect(route).toContain("loader: () => openSourcePageLoader()");
    expect(route).toMatch(
      /<OpenSourcePage \{\.\.\.Route\.useLoaderData\(\)\} bell=\{NotificationBell\} \/>/u,
    );
  });
});
