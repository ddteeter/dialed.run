import { describe, expect, it } from "vitest";

import { noInput } from "../../src/lib/no-input";

/**
 * The input of a server function that takes none (design 230).
 */
describe("noInput", () => {
  it("takes an empty object", () => {
    expect(noInput.parse({})).toStrictEqual({});
  });

  it("keeps nothing a caller adds", () => {
    expect(noInput.parse({ extra: 1 })).toStrictEqual({});
  });

  it.each([undefined, "x", 1])("refuses %j", (value) => {
    expect(noInput.safeParse(value).success).toBe(false);
  });
});
