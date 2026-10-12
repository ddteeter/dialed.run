import { describe, expect, it } from "vitest";

import { withoutComments } from "./source-text";

/**
 * Every route that draws the bell hands it both counts (FEED-3): the bell
 * draws a number for runs awaiting a verdict, and a route that loaded only
 * the unread count drew a dot where the number belonged — 14 routes did.
 *
 * `BelledLayout`'s props are required now, so the compiler refuses a route
 * that passes only a count. This holds the other half, which types cannot
 * see: that what a route spreads came from `bellStateFn` (directly, or
 * through the settings and legal loaders that call it on the route's
 * behalf), and that nothing hands the bell a hand-built count.
 *
 * Read as text: a route cannot be imported by a test.
 */
const routeSources: Record<string, string> = import.meta.glob(
  "../../src/routes/**/*.tsx",
  { query: "?raw", import: "default", eager: true },
);

/**
 * The loaders that fetch the bell for a route, each reaching
 * `bellStateFn` or `bellState` itself.
 */
const BELL_SOURCES = /\bbellStateFn\(\)|\blegalPageLoader\(/u;

const bellRoutes = Object.entries(routeSources)
  .map(([path, source]) => [path, withoutComments(source)] as const)
  .filter(([, source]) => /<BelledLayout\b|<LegalPage\b/u.test(source));

describe("every bell-bearing route passes the bell's counts", () => {
  it("finds the routes that draw the bell", () => {
    expect(bellRoutes.length).toBeGreaterThanOrEqual(20);
  });

  for (const [path, source] of bellRoutes) {
    it(`${path} loads the bell's state and spreads it whole`, () => {
      expect(source).toMatch(BELL_SOURCES);
      expect(source).not.toMatch(/\bunreadCount\s*=/u);
      expect(source).not.toMatch(/\bverdictsWaiting\s*=/u);
      if (source.includes("<BelledLayout")) {
        expect(source).toMatch(/<BelledLayout \{\.\.\.bell\}>/u);
      }
    });
  }

  it("leaves no route a count-only bell to load", () => {
    for (const source of Object.values(routeSources)) {
      expect(source).not.toMatch(/unreadNotificationCountFn/u);
    }
  });
});
