import { asc, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { beforeAll, describe, expect, it } from "vitest";

import { env } from "../../src/env";
import { HEX_DIGITS } from "../../src/lib/photo-fingerprint";
import {
  distanceBetweenSql,
  nearestOf,
} from "../../src/lib/sql/fingerprint-distance";
import { jsonEach, jsonField } from "../../src/lib/sql/json-list";

/**
 * Design 188: the column-to-column distance agrees with the one that
 * spells a fingerprint into the SQL, and with a Hamming distance counted
 * here, digit by digit and place by place.
 */

const stored = sqliteTable("distance_probe", { print: text("print") });

const db = () => drizzle(env.DIALED_CORE);

/**
A fingerprint of one digit throughout.
*/
const allOf = (digit: string) => digit.repeat(16);

/**
 * Fingerprints whose digits differ place by place, so a distance that
 * read the wrong place, or one place twice, comes out wrong.
 */
const MIXED = [
  "0123456789abcdef",
  "fedcba9876543210",
  "00000000ffffffff",
  "a5a5a5a55a5a5a5a",
  "13579bdf02468ace",
];

/**
Hamming distance between two hex fingerprints, counted in code.
*/
function hamming(one: string, other: string): number {
  let bits = 0;
  for (let index = 0; index < one.length; index += 1) {
    let diff =
      HEX_DIGITS.indexOf(one.charAt(index)) ^
      HEX_DIGITS.indexOf(other.charAt(index));
    while (diff > 0) {
      bits += diff & 1;
      diff >>= 1;
    }
  }
  return bits;
}

/**
Every stored print against every given one, by the column-to-column distance.
*/
async function distances(given: readonly string[]) {
  const items = given.map((print) => ({ print }));
  const theirs = db()
    .$with("given")
    .as(
      db()
        .select({ print: jsonField<string>("print").as("given_print") })
        .from(jsonEach(items)),
    );
  const theirPrint = sql<string>`${theirs.print}`;
  const distance = distanceBetweenSql(stored.print, theirPrint);
  return db()
    .with(theirs)
    .select({
      mine: stored.print,
      theirs: theirPrint,
      distance: sql<number>`${distance}`,
    })
    .from(stored)
    .crossJoin(theirs)
    .orderBy(asc(stored.print));
}

/**
Each hex digit, in value order.
*/
const DIGITS = Array.from({ length: HEX_DIGITS.length }, (_, index) =>
  HEX_DIGITS.charAt(index),
);

const STORED = [...DIGITS.map((digit) => allOf(digit)), ...MIXED];

beforeAll(async () => {
  await env.DIALED_CORE.exec(
    "CREATE TABLE IF NOT EXISTS distance_probe (print TEXT)",
  );
  await env.DIALED_CORE.exec("DELETE FROM distance_probe");
  await db()
    .insert(stored)
    // The last row has no print: a NULL, as a photo with no fingerprint.
    .values([...STORED.map((print) => ({ print })), {}]);
});

describe("distanceBetweenSql", () => {
  it("counts the bits between every pair of digits", async () => {
    const digits = DIGITS.map((digit) => allOf(digit));

    const rows = await distances(digits);

    const pairs = rows.filter(
      (row) => row.mine !== null && digits.includes(row.mine),
    );
    expect(pairs).toHaveLength(16 * 16);
    for (const row of pairs) {
      expect(row.distance).toBe(hamming(row.mine ?? "", row.theirs));
    }
  });

  it("reads each place of both fingerprints", async () => {
    const rows = await distances(MIXED);

    const known = rows.filter((row) => row.mine !== null);
    expect(known).toHaveLength(STORED.length * MIXED.length);
    for (const row of known) {
      expect(row.distance).toBe(hamming(row.mine ?? "", row.theirs));
    }
    // Not every pair is trivially equal or opposite.
    expect(new Set(known.map((row) => row.distance)).size).toBeGreaterThan(4);
  });

  it("is a NULL distance for a stored NULL, which no comparison keeps", async () => {
    const rows = await distances(["0123456789abcdef"]);

    expect(rows.find((row) => row.mine === null)?.distance).toBeNull();
  });

  it("agrees with the distance that spells the fingerprint in", async () => {
    for (const given of MIXED) {
      const spelt = await db()
        .select({
          mine: stored.print,
          distance: sql<number>`${nearestOf(stored.print, [given])}`,
        })
        .from(stored)
        .orderBy(asc(stored.print));
      const rows = await distances([given]);
      const bound = rows.map(({ mine, distance }) => ({ mine, distance }));
      expect(bound).toStrictEqual(spelt);
    }
  });
});
