import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { runConditions } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { verdictScale } from "../../src/lib/contracts";
import type { Conditions } from "../../src/lib/contracts";
import { newUlid } from "../../src/lib/ids";
import {
  bandBuckets,
  matchingEntriesStatement,
} from "../../src/modules/feed/consensus";
import { judgedFeelsLikeC } from "../../src/modules/feed/judged-conditions";
import { pointConditions } from "./conditions-fixture";
import {
  makeEntry,
  makeObservation,
  makeRun,
  makeUser,
  NOW,
  resetTables,
  syncRunConditions,
} from "./helpers";
import { matchTally } from "./synced-consensus";

/**
 * The copy's generated columns against the code they restate (derive,
 * don't mirror): `judged_feels_like_c` is `judgedFeelsLikeC` in SQL, and
 * `judged_bucket` its floor. Pinned here over every verdict on the scale,
 * unrated included, and over spans that cross zero.
 */

/**
An unrated entry's verdict: `unicorn/no-null` forbids the literal, as in `judged-conditions.test.ts`.
*/
const NO_VERDICT = z.null().parse(JSON.parse("null"));

function core() {
  return drizzle(env.DIALED_CORE);
}

const SPANS = [
  { start: 4.5, coldest: -2.5, warmest: 9.9 },
  { start: -0.5, coldest: -7.25, warmest: 0.75 },
  { start: 12, coldest: 12, warmest: 12 },
] as const;

function conditionsOf(span: (typeof SPANS)[number]): Conditions {
  const base = pointConditions({ tempC: span.start, feelsLikeC: span.start });
  return {
    ...base,
    span: {
      ...base.span,
      minFeelsLikeC: span.coldest,
      maxFeelsLikeC: span.warmest,
    },
  };
}

async function generated(span: (typeof SPANS)[number], verdict: number | null) {
  const runId = newUlid();
  await core().insert(runConditions).values({
    runId,
    userId: newUlid(),
    feelsLikeC: span.start,
    minFeelsLikeC: span.coldest,
    maxFeelsLikeC: span.warmest,
    verdict,
  });
  const [row] = await core()
    .select({
      judged: runConditions.judgedFeelsLikeC,
      bucket: runConditions.judgedBucket,
    })
    .from(runConditions)
    .where(eq(runConditions.runId, runId));
  return row;
}

beforeEach(async () => {
  await resetTables();
});

describe("judged_feels_like_c and judged_bucket", () => {
  it("are judgedFeelsLikeC and its floor, for every verdict and none", async () => {
    const verdicts = [NO_VERDICT, ...verdictScale.map((entry) => entry.value)];
    for (const span of SPANS) {
      for (const verdict of verdicts) {
        const expected = judgedFeelsLikeC(conditionsOf(span), verdict);
        const row = await generated(span, verdict);
        expect({ verdict, ...row }).toStrictEqual({
          verdict,
          judged: expected,
          bucket: Math.floor(expected),
        });
      }
    }
  });

  it("are empty while the run has no conditions", async () => {
    // Feed's half alone: an entry saved before its run settled.
    const runId = newUlid();
    await core().insert(runConditions).values({
      runId,
      userId: newUlid(),
      verdict: 1,
    });
    const [row] = await core()
      .select({
        judged: runConditions.judgedFeelsLikeC,
        bucket: runConditions.judgedBucket,
      })
      .from(runConditions)
      .where(eq(runConditions.runId, runId));
    expect(row?.judged).toBeNull();
    expect(row?.bucket).toBeNull();
  });
});

describe("bandBuckets", () => {
  it("is every whole degree a judged feels-like within 3° can floor to", () => {
    expect(bandBuckets(7)).toStrictEqual([4, 5, 6, 7, 8, 9, 10]);
    expect(bandBuckets(-0.5)).toStrictEqual([-4, -3, -2, -1, 0, 1, 2]);
    expect(bandBuckets(7.5)).toStrictEqual([4, 5, 6, 7, 8, 9, 10]);
  });
});

describe("the band at its edges", () => {
  const PLACE = { lat: 44.98, lng: -93.27 };

  async function runFeelingLike(feelsLikeC: number, ago: number) {
    const userId = await makeUser();
    const startedAt = NOW - ago;
    await makeObservation({ ...PLACE, startedAt, tempC: 9, feelsLikeC });
    const runId = await makeRun({ userId, ...PLACE, startedAt, durationS: 60 });
    await makeEntry({ userId, runId, createdAt: startedAt, verdict: 0 });
  }

  it("counts a run 3° off and drops one 3.5° off in an edge bucket", async () => {
    // Viewer at 7: buckets 4 to 10. 10.5 floors to 10, inside the seek,
    // and the exact check drops it; 10 itself is in.
    await runFeelingLike(10, 3600);
    await runFeelingLike(10.5, 7200);
    await runFeelingLike(4, 10_800);
    const tally = await matchTally(
      pointConditions({ tempC: 9, feelsLikeC: 7 }),
      NOW - 86_400,
    );
    expect(tally.runners).toBe(2);
  });
});

describe("matchingEntriesStatement's plan", () => {
  it("seeks the copy's band index first, then each entry by its run", async () => {
    await syncRunConditions();
    const { sql, params } = matchingEntriesStatement(
      core(),
      pointConditions({ tempC: 9, feelsLikeC: 7 }),
      NOW - 86_400,
      "01VIEWER",
    ).toSQL();
    const plan = await env.DIALED_CORE.prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .bind(...params)
      .all<{ detail: string }>();
    const details = plan.results.map((row) => row.detail);
    expect(details[0]).toMatch(
      /SEARCH run_conditions USING INDEX run_conditions_band \(precip_class=\? AND judged_bucket=\? AND entry_created_at>\?\)/u,
    );
    expect(details.join("\n")).toMatch(
      /SEARCH outfit_entries USING INDEX entries_run \(run_id=\?\)/u,
    );
    expect(details.join("\n")).not.toMatch(
      /SCAN (run_conditions|outfit_entries)/u,
    );
  });
});
