import { describe, expect, it } from "vitest";

import { outfitEntries, runs } from "../../src/db/schema-core";
import { newUlid } from "../../src/lib/ids";
import { exportData, type ExportData } from "../../src/modules/account/export";
import { buildSheets } from "../../src/modules/account/export-sheets";
import { core } from "../email/helpers";

/**
 * The export ZIP's five column tables (task 126, ACC-10; round 27 #13),
 * unit-tested directly against `buildSheets` rather than through
 * `exportFiles` — the "about" sentences and the id columns are static, so
 * they need no seeded data, and the one dynamic branch (a photo the caller
 * never resolved) needs a map `exportFiles` itself can never hand it
 * incomplete.
 */

const db = core();

function emptyData(): ExportData {
  return {
    account: undefined,
    profile: undefined,
    garments: [],
    runs: [],
    entries: [],
    uploads: [],
  };
}

describe("buildSheets", () => {
  it("names what each sheet holds, and what its id column is for", () => {
    const sheets = buildSheets({
      data: emptyData(),
      runFileOf: new Map(),
      entryPhotos: new Map(),
      garmentPhotos: new Map(),
    });

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

  it("throws rather than silently hiding photos for an entry the resolved-photo map does not know", async () => {
    const userId = newUlid();
    const runId = newUlid();
    await db.insert(runs).values({
      id: runId,
      userId,
      source: "manual",
      startedAt: 0,
      durationS: 0,
      distanceM: 0,
      title: "run",
    });
    const entryId = newUlid();
    await db.insert(outfitEntries).values({
      id: entryId,
      runId,
      userId,
      createdAt: 0,
    });

    const data = await exportData(db, userId);
    const sheets = buildSheets({
      data,
      runFileOf: new Map(),
      // Deliberately missing entryId: export-files.ts never builds this
      // map incomplete, so this can only happen if that invariant breaks.
      entryPhotos: new Map(),
      garmentPhotos: new Map(),
    });
    const photosColumn = sheets.entriesSheet.columns.find(
      (column) => column.name === "photos",
    );
    const [row] = sheets.entriesSheet.rows;
    if (row === undefined || photosColumn === undefined) {
      throw new Error("expected one entry row and a photos column");
    }
    expect(row.id).toBe(entryId);
    expect(() => photosColumn.value(row)).toThrow(
      `export-sheets: no resolved photos for entry ${entryId}`,
    );
  });
});
