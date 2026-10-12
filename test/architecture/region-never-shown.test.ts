import { describe, expect, it } from "vitest";

/**
 * A runner's region is "used only in aggregates, never shown on a profile
 * or entry" (round 30 data requirement (d)), and Settings promises them so
 * ("Never shown to anyone."). Nothing about a profile or an entry page
 * would fail if one started reading it, so this pins who may: the column,
 * its contract, its one writer, Settings, and the export of the runner's
 * own data. A guide job that groups totals by region adds itself here, in
 * the PR a reviewer can read it in.
 *
 * Read as text, as the other architecture tests are: a route cannot be
 * imported by a test.
 */
const sources: Record<string, string> = import.meta.glob(
  "../../src/**/*.{ts,tsx}",
  { query: "?raw", import: "default", eager: true },
);

// `.region` too: `currentSettings` returns the region under that name, so
// a route reading the settings object would carry it without naming a
// column. The behaviour is observed in test/feed/region-never-shown.test.ts.
const MENTIONS =
  /\b(?:regionCountry|regionSubdivision|region_country|region_subdivision|regionLabel)\b|\.region\b|lib\/contracts\/regions/u;

const MAY_READ_THE_REGION = [
  "src/db/schema-core.ts",
  "src/lib/contracts/regions.ts",
  "src/modules/account/export-sheets.ts",
  "src/modules/onboarding/aggregate-prefs.ts",
  "src/modules/onboarding/components/Settings.tsx",
  "src/modules/onboarding/functions.ts",
  "src/modules/onboarding/profile.ts",
];

describe("the region is never shown (round 30 (d))", () => {
  it("is read only by its column, contract, writer, Settings and the export", () => {
    const readers = Object.entries(sources)
      .filter(([, text]) => MENTIONS.test(text))
      .map(([path]) => path.replace("../../", ""))
      .toSorted((a, b) => a.localeCompare(b));
    expect(readers).toStrictEqual(MAY_READ_THE_REGION);
  });
});
