import { describe, expect, it } from "vitest";

import { afterOf } from "../../src/ui/PageLinks";

describe("afterOf", () => {
  it("is the search's `after` alone", () => {
    expect(afterOf({ search: { after: "0.1.X" } })).toStrictEqual({
      after: "0.1.X",
    });
    expect(afterOf({ search: {} })).toStrictEqual({ after: undefined });
  });
});
