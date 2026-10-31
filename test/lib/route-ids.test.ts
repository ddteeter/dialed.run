import { describe, expect, it } from "vitest";

import routeTreeSource from "../../src/routeTree.gen.ts?raw";
import { leafRouteIds, routeMatcher } from "../../src/lib/route-ids";

/**
 * Design 165 groups every speed measurement by route id. `routeTree.gen`
 * cannot be imported here (it pulls every route, and a route pulls server
 * functions), so the matcher is pinned against that file's text: every id
 * the generator registers must match a path built from itself.
 */

/**
The `FileRoutesById` keys, read from the generated file.
*/
function generatedIds(): string[] {
  const block = /export interface FileRoutesById \{([\s\S]*?)\n\}/.exec(
    routeTreeSource,
  );
  expect(block).not.toBeNull();
  return Array.from(
    (block?.[1] ?? "").matchAll(/^ +'([^']+)':/gm),
    ([, id]) => id ?? "",
  );
}

/**
 * The generated ids a request can end on: not the root, and not a layout,
 * which is an id another id continues past a slash.
 */
function generatedLeaves(): string[] {
  const ids = generatedIds().filter((id) => id !== "__root__");
  return ids.filter(
    (id) =>
      id.endsWith("/") || ids.every((other) => !other.startsWith(`${id}/`)),
  );
}

/**
A concrete path for a route id: each param filled, a splat given two segments.
*/
function samplePath(id: string): string {
  return id
    .replaceAll(/\{\$[^}]*\}/g, "x1")
    .replaceAll(/\/\$(?=\/|$)/g, "/a/b")
    .replaceAll(/\$[^/]+/g, "x1");
}

const node = (id: string, children?: unknown[]) => ({
  options: { id },
  ...(children !== undefined && { children }),
});

describe("leafRouteIds", () => {
  it("joins each id to its parent's and keeps only the routes a request ends on", () => {
    const tree = {
      options: {},
      children: [
        node("/"),
        node("/desk", [node("/access"), node("/")]),
        node("/runs/$runId"),
      ],
    };
    expect(leafRouteIds(tree)).toEqual([
      "/",
      "/desk/access",
      "/desk/",
      "/runs/$runId",
    ]);
  });

  it("refuses a tree whose routes carry no id", () => {
    expect(() => leafRouteIds({ children: [{ options: {} }] })).toThrow();
    expect(() => leafRouteIds({})).toThrow();
  });
});

// Built per call, never once at describe time: a matcher built in the
// describe body would make its mutants static, which the workers pool never
// activates.
function match(pathname: string): string | undefined {
  return routeMatcher([
    "/",
    "/runs/",
    "/runs/$runId",
    "/runs/backlog",
    "/runs/import/$importId",
    "/@{$handle}",
    "/feed/photo/$",
    "/feed/$",
    "/a.b",
  ])(pathname);
}

describe("routeMatcher", () => {
  it("matches every route the generator registers, from a path built from itself", () => {
    const leaves = generatedLeaves();
    expect(leaves.length).toBeGreaterThan(50);
    expect(leaves).toContain("/desk/");
    expect(leaves).not.toContain("/desk");
    const matchLeaf = routeMatcher(leaves);
    for (const id of leaves) {
      expect(matchLeaf(samplePath(id)), id).toBe(id);
    }
  });

  it("prefers a literal segment to a param, and a param to a splat", () => {
    expect(match("/runs/backlog")).toBe("/runs/backlog");
    expect(match("/runs/abc")).toBe("/runs/$runId");
    expect(match("/feed/photo/x/y")).toBe("/feed/photo/$");
    expect(match("/feed/other")).toBe("/feed/$");
  });

  it("orders the same way whichever order the ids arrive in", () => {
    const reversed = routeMatcher([
      "/feed/$",
      "/runs/$runId",
      "/runs/backlog",
      "/feed/photo/$",
    ]);
    expect(reversed("/runs/backlog")).toBe("/runs/backlog");
    expect(reversed("/feed/photo/x")).toBe("/feed/photo/$");
  });

  it("ranks a longer route over its own prefix only where the prefix allows it", () => {
    const prefixed = routeMatcher(["/feed/$", "/feed/photo/$"]);
    expect(prefixed("/feed/photo")).toBe("/feed/photo/$");
    expect(prefixed("/feed")).toBe("/feed/$");
  });

  it("prefers a route that ends where the path does to a splat with nothing to take", () => {
    expect(routeMatcher(["/feed/$", "/feed"])("/feed")).toBe("/feed");
    expect(routeMatcher(["/feed/$", "/feed"])("/feed/x")).toBe("/feed/$");
  });

  it("prefers a literal segment to a template, and a template to a param", () => {
    expect(routeMatcher(["/@{$handle}", "/@me"])("/@me")).toBe("/@me");
    expect(routeMatcher(["/$id", "/@{$handle}"])("/@me")).toBe("/@{$handle}");
    expect(routeMatcher(["/$id", "/@{$handle}"])("/me")).toBe("/$id");
    // The first segment decides even when a literal follows the param.
    expect(routeMatcher(["/$id/b", "/@{$handle}/b"])("/@me/b")).toBe(
      "/@{$handle}/b",
    );
  });

  it("treats an index route and its path with or without the trailing slash alike", () => {
    expect(match("/runs")).toBe("/runs/");
    expect(match("/runs/")).toBe("/runs/");
    expect(match("/")).toBe("/");
  });

  it("fills a template segment only between its literal parts", () => {
    expect(match("/@someone")).toBe("/@{$handle}");
    expect(match("/someone")).toBeUndefined();
  });

  it("gives a param exactly one segment", () => {
    expect(match("/runs/import/abc")).toBe("/runs/import/$importId");
    expect(match("/runs/import")).toBe("/runs/$runId");
    expect(match("/runs/abc/def")).toBeUndefined();
  });

  it("matches a literal segment literally", () => {
    expect(match("/a.b")).toBe("/a.b");
    expect(match("/aXb")).toBeUndefined();
    expect(match("/xa.b")).toBeUndefined();
    expect(match("/a.bx")).toBeUndefined();
  });

  it("matches nothing for a path no route covers", () => {
    expect(match("/nowhere")).toBeUndefined();
    expect(routeMatcher([])("/")).toBeUndefined();
  });
});
