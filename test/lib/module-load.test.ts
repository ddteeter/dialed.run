import { describe, expect, it } from "vitest";

/**
 * These modules build a derived table at import time, and a failure there
 * takes the whole module down.
 *
 * They are imported **dynamically**, inside the test, on purpose. A static
 * import at the top of a file means a module that throws on load takes the
 * *file* with it — vitest then reports "no tests ran" rather than a failing
 * test, and anything counting failures sees none.
 *
 * That is not hypothetical. Mutation testing reported the construction of
 * `garmentFieldSpec` as a surviving mutant: replacing the map callback with
 * `() => undefined` makes `new Map` throw `Iterator value undefined is not
 * an entry object`, every test file importing it fails to load, and stryker
 * — reading zero failed tests — recorded it as *not killed*. The mutation
 * broke everything and looked like nothing.
 *
 * So any module whose top level does real work wants one of these. The
 * dynamic import turns "the suite did not run" into "this test failed".
 */

describe("modules that build a table at import time", () => {
  it("builds the garment field spec", async () => {
    const { garmentFieldSpec, garmentCategoriesInOrder } = await import(
      "../../src/lib/garment-fields"
    );
    expect(garmentCategoriesInOrder.length).toBeGreaterThan(0);
    expect(garmentFieldSpec.size).toBe(garmentCategoriesInOrder.length);
    for (const category of garmentCategoriesInOrder) {
      expect(garmentFieldSpec.get(category)).toBeInstanceOf(Set);
    }
  });

  it("builds the thermal tables", async () => {
    const { estimateTempRange } = await import("../../src/lib/thermal");
    expect(estimateTempRange({ category: "top", weight: "mid" })).toEqual({
      lowC: 4,
      highC: 15,
    });
  });

  it("builds the garment contract union", async () => {
    const { garmentSchema } = await import("../../src/lib/contracts");
    expect(garmentSchema.options.length).toBeGreaterThan(0);
  });
});
