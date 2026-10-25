import { describe, expect, it } from "vitest";

import routeTree from "../../src/routeTree.gen.ts?raw";

/**
 * **The generated route tree keeps TanStack Start's registration block.**
 *
 * Two things write `src/routeTree.gen.ts` and they disagree: the vite plugin
 * (during `npm run build`) appends a `declare module '@tanstack/react-start'`
 * block registering `ssr: true` and the router type, and `npm run
 * generate-routes` (`tsr generate`) does not. Neither tsc nor any other gate
 * notices the block going, so a regenerate-then-commit silently deletes the
 * Start SSR registration. If this fails: run `npm run build`, which writes
 * the block back, and commit that.
 */

const REGISTRATION =
  /declare module '@tanstack\/react-start' \{\s*interface Register \{[^}]*\bssr: true\b/u;

function hasStartRegistration(source: string): boolean {
  return REGISTRATION.test(source);
}

describe("routeTree.gen.ts", () => {
  it("carries the Start registration the vite plugin writes", () => {
    expect(
      hasStartRegistration(routeTree),
      "routeTree.gen.ts lost its `declare module '@tanstack/react-start'` block — run `npm run build` to regenerate it (see .claude/rules/routes.md)",
    ).toBe(true);
  });

  it("would notice the block missing, or registering without ssr", () => {
    expect(hasStartRegistration("export const routeTree = x\n")).toBe(false);
    expect(
      hasStartRegistration(
        "declare module '@tanstack/react-start' {\n  interface Register {\n    router: R\n  }\n}",
      ),
    ).toBe(false);
    expect(
      hasStartRegistration(
        "declare module '@tanstack/react-start' {\n  interface Register {\n    ssr: true\n    router: R\n  }\n}",
      ),
    ).toBe(true);
  });
});
