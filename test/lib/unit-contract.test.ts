import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { userProfiles } from "../../src/db/schema-core";
import {
  defaultUnits,
  distanceUnitSchema,
  tempUnitSchema,
} from "../../src/lib/contracts";

/**
 * D-7: the unit vocabularies were written twice — a bare `"f" | "c"` union
 * in `lib/temperature.ts` and a column enum in `db/schema-core.ts` — with
 * nothing making them agree. Two lists that mean one thing drift in
 * silence, because nothing fails when they disagree.
 *
 * These read the columns rather than restating their values, so adding a
 * unit to the schema without adding it to the contract fails here instead
 * of at a call site months later (CLAUDE.md, "derive, don't mirror").
 */
function columnEnum(name: "tempUnit" | "distanceUnit"): readonly string[] {
  return getTableColumns(userProfiles)[name].enumValues;
}

describe("the unit contract and the columns that store it", () => {
  it("offers exactly the temperature units the column accepts", () => {
    expect(new Set(tempUnitSchema.options)).toStrictEqual(
      new Set(columnEnum("tempUnit")),
    );
  });

  it("offers exactly the distance units the column accepts", () => {
    expect(new Set(distanceUnitSchema.options)).toStrictEqual(
      new Set(columnEnum("distanceUnit")),
    );
  });

  it("reads the columns rather than a hand-written copy of them", () => {
    // Guards the guard: if `enumValues` ever came back empty, both
    // assertions above would compare an empty set to an empty set and pass
    // while checking nothing.
    expect(columnEnum("tempUnit").length).toBeGreaterThan(1);
    expect(columnEnum("distanceUnit").length).toBeGreaterThan(1);
  });

  it("defaults to units the contract itself admits", () => {
    expect(tempUnitSchema.safeParse(defaultUnits.temp).success).toBe(true);
    expect(distanceUnitSchema.safeParse(defaultUnits.distance).success).toBe(
      true,
    );
  });

  it("refuses a unit neither vocabulary contains", () => {
    expect(tempUnitSchema.safeParse("k").success).toBe(false);
    expect(distanceUnitSchema.safeParse("furlong").success).toBe(false);
  });
});
