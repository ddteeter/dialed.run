import { describe, expect, it } from "vitest";

import { linkSearchInput } from "../../src/modules/email/inputs";

/**
 * An unsubscribe link's search, held as-is — checked by its signature in
 * `switchByLink`, not here.
 */
describe("linkSearchInput", () => {
  it("keeps the search value it was given, under its own key", () => {
    const search = { u: "u1", k: "run_reminder", s: "sig" };
    expect(linkSearchInput.parse({ search })).toStrictEqual({ search });
  });
});
