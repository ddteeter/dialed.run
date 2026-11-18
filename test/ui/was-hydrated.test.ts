import { describe, expect, it } from "vitest";

import { wasHydrated } from "../../src/ui/use-hydrated";

/**
 * In workerd, as the server render runs it: no `document`, so nothing has
 * hydrated, and the terms prompt's return line is left out of the server's
 * draw (R60·60b). The browser's answers are `use-saved-page.dom.test.tsx`'s.
 */
describe("wasHydrated on the server", () => {
  it("is false where there is no document", () => {
    expect(typeof document).toBe("undefined");
    expect(wasHydrated()).toBe(false);
  });
});
