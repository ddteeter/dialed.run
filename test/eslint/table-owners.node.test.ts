/**
 * The owner map (`eslint/table-owners.ts`, design 263) against what it
 * names. tsc already rejects a table or a column the schema does not have;
 * this pins the map's keys to the schema's tables at run time, and each
 * module it names to a real folder, which no type can see.
 */
import { existsSync } from "node:fs";

import { getTableName, isTable } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import * as auth from "../../src/db/schema-auth";
import * as core from "../../src/db/schema-core";
import * as ops from "../../src/db/schema-ops";
import * as weather from "../../src/db/schema-weather";
import { tableOwners } from "../../eslint/table-owners";

const schemaTables = [auth, core, ops, weather]
  .flatMap((schema): unknown[] => Object.values(schema))
  .filter((value) => isTable(value))
  .map((table) => getTableName(table));

const entries = Object.values(tableOwners);

const areas = new Set(
  entries.flatMap((entry) => [entry.owner, ...Object.keys(entry.others ?? {})]),
);

function byName(a: string, b: string): number {
  return a.localeCompare(b);
}

function folderOf(area: string): string {
  return area.startsWith("src/") ? area : `src/modules/${area}`;
}

describe("the owner map", () => {
  it("has one entry for every table in the schema, and no other", () => {
    expect(Object.keys(tableOwners).toSorted(byName)).toStrictEqual(
      schemaTables.toSorted(byName),
    );
  });

  it.each([...areas])("names `%s`, a real folder", (area) => {
    expect(existsSync(folderOf(area))).toBe(true);
  });

  it("never lists a table's owner among its other writers", () => {
    const doubled = Object.entries(tableOwners).filter(
      ([, entry]) => entry.others?.[entry.owner] !== undefined,
    );
    expect(doubled).toStrictEqual([]);
  });
});
