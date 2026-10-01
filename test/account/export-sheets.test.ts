import { describe, expect, it } from "vitest";

import { buildSheets } from "../../src/modules/account/export-sheets";

/**
 * The export ZIP's five column tables (task 126, ACC-10; round 27 #13),
 * unit-tested directly against `buildSheets` rather than through
 * `exportFiles`: the "about" sentences and the id columns are static, so
 * they need no seeded data. Every value a column reads is decided on
 * `exportFiles`' row-building step, and tested there
 * (`export.test.ts`).
 */

const NO_ROWS = {
  profile: { account: undefined, profile: undefined },
  runs: [],
  entries: [],
  kit: [],
  garments: [],
};

describe("buildSheets", () => {
  it("names what each sheet holds, and what its id column is for", () => {
    const sheets = buildSheets(NO_ROWS);

    expect(sheets.profileSheet.about).toBe(
      "your account and settings, one row.",
    );
    expect(sheets.runsSheet.about).toBe("every run, oldest first.");
    expect(sheets.runsSheet.columns[0]?.about).toBe(
      "the run's id; entries.csv names it.",
    );
    expect(sheets.entriesSheet.about).toBe(
      "every kit you logged, with its verdict.",
    );
    expect(sheets.entriesSheet.columns[0]?.about).toBe(
      "the entry's id; kit.csv names it.",
    );
    expect(sheets.kitSheet.about).toBe(
      "each garment in each kit, one row a garment.",
    );
    expect(sheets.garmentsSheet.about).toBe(
      "your closet, retired garments included.",
    );
    expect(sheets.garmentsSheet.columns[0]?.about).toBe(
      "the garment's id; kit.csv names it.",
    );
  });

  it("puts the one profile row it is handed in profile.csv", () => {
    const profile = { account: undefined, profile: undefined };
    expect(
      buildSheets({ ...NO_ROWS, profile }).profileSheet.rows,
    ).toStrictEqual([profile]);
  });
});
