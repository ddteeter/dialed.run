import { beforeEach, describe, expect, it } from "vitest";

import { perfDaily } from "../../src/db/schema-ops";
import { opsDb } from "../../src/env";
import {
  BASELINE_DAYS,
  MEDIAN_TOLERANCE,
  MIN_BASELINE_DAYS,
  MIN_N,
  overLimit,
  overMedian,
  runSpeedChecks,
  SPEED_LIMITS,
  type PerfRow,
} from "../../src/modules/ops/perf-checks";
import {
  dailySpeed,
  speedDigestDepsFromEnv,
} from "../../src/modules/ops/speed-digest";

/**
 * The daily speed checks (design 165, step 7).
 */

const DAY = "2026-10-30";

function row(overrides: Partial<PerfRow> = {}): PerfRow {
  return {
    day: DAY,
    route: "/closet/",
    metric: "LCP",
    device: "narrow",
    p75: 1000,
    p95: 1000,
    n: 40,
    ...overrides,
  };
}

describe("the thresholds", () => {
  it("start where design 165 put them", () => {
    expect(SPEED_LIMITS).toStrictEqual({
      LCP: { stat: "p75", limit: 2500 },
      INP: { stat: "p75", limit: 200 },
      CLS: { stat: "p75", limit: 0.1 },
      nav: { stat: "p75", limit: 1000 },
      server: { stat: "p95", limit: 1000 },
    });
    expect(MIN_N).toBe(30);
    expect(MEDIAN_TOLERANCE).toBe(1.25);
    expect(BASELINE_DAYS).toBe(7);
    expect(MIN_BASELINE_DAYS).toBe(3);
  });
});

describe("overLimit", () => {
  it.each([
    ["LCP", 2500, 2501],
    ["INP", 200, 201],
    ["CLS", 0.1, 0.1001],
    ["nav", 1000, 1001],
  ] as const)(
    "%s: silent at its limit, a line just over it",
    (metric, at, over) => {
      expect(overLimit([row({ metric, p75: at })], DAY)).toStrictEqual([]);
      expect(overLimit([row({ metric, p75: over })], DAY)).toHaveLength(1);
    },
  );

  it("says what, where, how much and how many, in milliseconds", () => {
    expect(overLimit([row({ p75: 2600.4, n: 41 })], DAY)).toStrictEqual([
      "LCP p75 on /closet/ (narrow) was 2600 ms on 2026-10-30, over its 2500 ms limit (n=41)",
    ]);
  });

  it("shows CLS as a score", () => {
    expect(
      overLimit([row({ metric: "CLS", p75: 0.25, device: "wide" })], DAY),
    ).toStrictEqual([
      "CLS p75 on /closet/ (wide) was 0.250 on 2026-10-30, over its 0.100 limit (n=40)",
    ]);
  });

  it("judges the server at p95, and only its 2xx responses", () => {
    const slow = { metric: "server", p75: 10, p95: 1001 };
    expect(overLimit([row({ ...slow, device: "2xx" })], DAY)).toStrictEqual([
      "server p95 on /closet/ (2xx) was 1001 ms on 2026-10-30, over its 1000 ms limit (n=40)",
    ]);
    expect(overLimit([row({ ...slow, device: "5xx" })], DAY)).toStrictEqual([]);
    expect(
      overLimit(
        [row({ metric: "server", device: "2xx", p75: 5000, p95: 1000 })],
        DAY,
      ),
    ).toStrictEqual([]);
  });

  it("judges p75 for the browser, not p95", () => {
    expect(overLimit([row({ p75: 2000, p95: 9000 })], DAY)).toStrictEqual([]);
  });

  it("does not judge FCP or TTFB", () => {
    expect(
      overLimit(
        [
          row({ metric: "FCP", p75: 99_000 }),
          row({ metric: "TTFB", p75: 99_000 }),
        ],
        DAY,
      ),
    ).toStrictEqual([]);
  });

  it("is silent below MIN_N samples, and speaks at it", () => {
    expect(overLimit([row({ p75: 9000, n: 29 })], DAY)).toStrictEqual([]);
    expect(overLimit([row({ p75: 9000, n: 30 })], DAY)).toHaveLength(1);
  });

  it("judges only the day asked about", () => {
    expect(
      overLimit([row({ day: "2026-10-29", p75: 9000 })], DAY),
    ).toStrictEqual([]);
  });
});

/**
 * Baseline rows on the days before DAY, one value each.
 */
function baseline(values: readonly number[], overrides: Partial<PerfRow> = {}) {
  return values.map((p75, index) =>
    row({ day: `2026-10-${String(29 - index)}`, p75, ...overrides }),
  );
}

describe("overMedian", () => {
  it("fires past 25% over the median of the days before, and not at it", () => {
    const before = baseline([300, 100, 200]);
    expect(overMedian([...before, row({ p75: 250 })], DAY)).toStrictEqual([]);
    expect(overMedian([...before, row({ p75: 250.1 })], DAY)).toStrictEqual([
      "LCP p75 on /closet/ (narrow) was 250 ms on 2026-10-30, more than 25% over its 3-day median of 200 ms (n=40)",
    ]);
  });

  it("takes the mean of the middle two for an even count", () => {
    const before = baseline([400, 100, 300, 200]);
    expect(overMedian([...before, row({ p75: 312.5 })], DAY)).toStrictEqual([]);
    expect(overMedian([...before, row({ p75: 312.6 })], DAY)).toStrictEqual([
      expect.stringContaining("4-day median of 250 ms"),
    ]);
  });

  it("is silent with fewer than three baseline days", () => {
    expect(
      overMedian([...baseline([100, 100]), row({ p75: 9000 })], DAY),
    ).toStrictEqual([]);
  });

  it("leaves out baseline days below MIN_N, and later days", () => {
    const thin = baseline([100, 100, 100], { n: 29 });
    expect(overMedian([...thin, row({ p75: 9000 })], DAY)).toStrictEqual([]);
    const later = [
      ...baseline([100, 100]),
      row({ day: "2026-10-31", p75: 100 }),
    ];
    expect(overMedian([...later, row({ p75: 9000 })], DAY)).toStrictEqual([]);
  });

  it("keeps routes, metrics and devices apart", () => {
    const before = baseline([100, 100, 100]);
    expect(
      overMedian(
        [
          ...before,
          row({ route: "/feed/", p75: 9000 }),
          row({ device: "wide", p75: 9000 }),
          row({ metric: "INP", p75: 150 }),
        ],
        DAY,
      ),
    ).toStrictEqual([]);
  });

  it("is silent for a day below MIN_N, and judges the server on p95", () => {
    expect(
      overMedian(
        [...baseline([100, 100, 100]), row({ p75: 9000, n: 29 })],
        DAY,
      ),
    ).toStrictEqual([]);
    const server = { metric: "server", device: "2xx" };
    const before = [100, 100, 100].map((p95, index) =>
      row({ ...server, day: `2026-10-${String(29 - index)}`, p75: 1, p95 }),
    );
    expect(
      overMedian([...before, row({ ...server, p75: 1, p95: 200 })], DAY),
    ).toStrictEqual([
      "server p95 on /closet/ (2xx) was 200 ms on 2026-10-30, more than 25% over its 3-day median of 100 ms (n=40)",
    ]);
  });
});

describe("runSpeedChecks", () => {
  it("runs every check whichever of them throws", () => {
    const anomalies: string[] = [];
    runSpeedChecks(
      [
        () => {
          throw new Error("bad row");
        },
        () => ["a line"],
      ],
      anomalies,
    );
    expect(anomalies).toStrictEqual([
      "a speed check failed: Error: bad row",
      "a line",
    ]);
  });
});

/**
 * A SQL API that answers yesterday with `yesterday` and the other days
 * with nothing.
 */
function rollupAnswering(yesterday: readonly PerfRow[]) {
  return {
    query: (sql: string): Promise<unknown> =>
      Promise.resolve({
        data: sql.includes(`>= toDateTime('${DAY} 00:00:00'`)
          ? yesterday.map(({ route, metric, device, p75, p95, n }) => ({
              route,
              metric,
              device,
              p50: 1,
              p75,
              p95,
              n,
            }))
          : [],
      }),
    db: opsDb(),
  };
}

async function seed(rows: readonly PerfRow[]): Promise<void> {
  for (const seeded of rows) {
    await opsDb()
      .insert(perfDaily)
      .values({ ...seeded, p50: 1 });
  }
}

describe("dailySpeed", () => {
  beforeEach(async () => {
    await opsDb().delete(perfDaily);
  });

  it("rolls up, then judges yesterday against its limit and its last week", async () => {
    // Days four to six before today: outside the rollup's three, inside
    // the baseline's seven.
    await seed(
      ["2026-10-27", "2026-10-26", "2026-10-25"].map((day) =>
        row({ day, p75: 1000 }),
      ),
    );
    const anomalies: string[] = [];

    await dailySpeed("2026-10-31", anomalies, {
      rollup: rollupAnswering([row({ p75: 2600 })]),
      db: opsDb(),
    });

    expect(anomalies).toStrictEqual([
      "LCP p75 on /closet/ (narrow) was 2600 ms on 2026-10-30, over its 2500 ms limit (n=40)",
      "LCP p75 on /closet/ (narrow) was 2600 ms on 2026-10-30, more than 25% over its 3-day median of 1000 ms (n=40)",
    ]);
  });

  it("reads seven days of baseline and no more", async () => {
    // Eight days before is the oldest the baseline reads; nine is not.
    await seed(
      ["2026-10-24", "2026-10-23", "2026-10-22"].map((day) =>
        row({ day, p75: 1000 }),
      ),
    );
    const inside: string[] = [];
    await dailySpeed("2026-10-31", inside, {
      rollup: rollupAnswering([row({ p75: 2000 })]),
      db: opsDb(),
    });
    // 2026-10-22 is nine days before: two baseline days, so silent.
    expect(inside).toStrictEqual([]);

    await opsDb().delete(perfDaily);
    await seed(
      ["2026-10-24", "2026-10-23", "2026-10-25"].map((day) =>
        row({ day, p75: 1000 }),
      ),
    );
    const edge: string[] = [];
    await dailySpeed("2026-10-31", edge, {
      rollup: rollupAnswering([row({ p75: 2000 })]),
      db: opsDb(),
    });
    expect(edge).toStrictEqual([
      expect.stringContaining("3-day median of 1000 ms"),
    ]);
  });
});

describe("speedDigestDepsFromEnv", () => {
  it("asks the configured SQL API and reads the ops database", async () => {
    const deps = speedDigestDepsFromEnv();
    expect(deps.rollup.query).toBeTypeOf("function");
    await opsDb().delete(perfDaily);
    await seed([row()]);
    expect(await deps.db.select().from(perfDaily)).toHaveLength(1);
  });
});
