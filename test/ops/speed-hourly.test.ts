import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type SpeedFinding,
  deployRegressions,
  DRIFT_FLOOR,
  DRIFT_MADS,
  DRIFT_WEEKS,
  drifts,
  MIN_DRIFT_WEEKS,
  type Measured,
  type VersionRow,
} from "../../src/modules/ops/perf-checks";
import {
  checkDeployRegressions,
  checkDrift,
  hourlySpeed,
  VERSION_DAYS,
  WINDOW_HOURS,
} from "../../src/modules/ops/speed-hourly";
import {
  versionQuery,
  windowQuery,
} from "../../src/modules/ops/vitals-queries";

/**
 * The hourly speed checks (design 165, step 8): synthetic series for a
 * clean regression, one noisy window, two in a row, too few samples, and a
 * first deploy.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function measured(overrides: Partial<Measured> = {}): Measured {
  return {
    route: "/closet/",
    metric: "LCP",
    device: "narrow",
    p75: 1000,
    p95: 1000,
    n: 40,
    ...overrides,
  };
}

function deploy(
  version: string,
  firstSeen: number,
  overrides: Partial<VersionRow> = {},
): VersionRow {
  return { ...measured(), version, firstSeen, lastSeen: NOW, ...overrides };
}

describe("the hourly thresholds", () => {
  it("start where design 165 put them", () => {
    expect(DRIFT_MADS).toBe(3);
    expect(DRIFT_FLOOR).toBeCloseTo(0.1, 10);
    expect(DRIFT_WEEKS).toBe(4);
    expect(MIN_DRIFT_WEEKS).toBe(3);
    expect(WINDOW_HOURS).toBe(3);
    expect(VERSION_DAYS).toBe(7);
  });
});

describe("deployRegressions", () => {
  it("fires when the newest deploy is more than 25% slower than the last", () => {
    expect(
      deployRegressions(
        [
          deploy("v1", 100, { p75: 1000 }),
          deploy("v2", 200, { p75: 1251, n: 35 }),
        ],
        0,
      ),
    ).toStrictEqual([
      {
        check: "deploy-regression",
        route: "/closet/",
        metric: "LCP",
        line: "LCP p75 on /closet/ (narrow) is 1251 ms on deploy v2, more than 25% over 1000 ms on v1 (n=35 and 40)",
      },
    ]);
  });

  it("is silent at exactly 25% slower", () => {
    expect(
      deployRegressions(
        [deploy("v1", 100, { p75: 1000 }), deploy("v2", 200, { p75: 1250 })],
        0,
      ),
    ).toStrictEqual([]);
  });

  it("orders deploys by when each was first measured, not by row order", () => {
    const rows = [
      deploy("v2", 200, { p75: 1000 }),
      deploy("v1", 100, { p75: 5000 }),
    ];
    expect(deployRegressions(rows, 0)).toStrictEqual([]);
    expect(deployRegressions(rows.toReversed(), 0)).toStrictEqual([]);
  });

  it("dates a deploy by its earliest row", () => {
    // v1 was first seen at 100 on one screen, though its other row says
    // 300: v2 (200) is newer.
    const rows = [
      deploy("v1", 300, { route: "/feed/", p75: 1000 }),
      deploy("v1", 100, { p75: 1000 }),
      deploy("v2", 200, { p75: 2000 }),
    ];
    expect(deployRegressions(rows, 0)).toHaveLength(1);
  });

  it("compares the newest with the one just before it, not an older one", () => {
    expect(
      deployRegressions(
        [
          deploy("v1", 100, { p75: 100 }),
          deploy("v2", 200, { p75: 1000 }),
          deploy("v3", 300, { p75: 1100 }),
        ],
        0,
      ),
    ).toStrictEqual([]);
    // Nor judges an older deploy against the one before the newest.
    expect(
      deployRegressions(
        [
          deploy("v1", 100, { p75: 9000 }),
          deploy("v2", 200, { p75: 1000 }),
          deploy("v3", 300, { p75: 1000 }),
        ],
        0,
      ),
    ).toStrictEqual([]);
  });

  it("goes quiet when the newest deploy stops serving, as after a rollback", () => {
    // v2 was slow and served until 300; v1, older, has served since.
    const rows = [
      deploy("v1", 100, { p75: 1000, lastSeen: 500 }),
      deploy("v2", 200, { p75: 2000, lastSeen: 300 }),
    ];
    expect(deployRegressions(rows, 400)).toStrictEqual([]);
    expect(deployRegressions(rows, 301)).toStrictEqual([]);
    expect(deployRegressions(rows, 300)).toHaveLength(1);
  });

  it("is silent for a first deploy, and for none", () => {
    expect(
      deployRegressions([deploy("v1", 100, { p75: 9000 })], 0),
    ).toStrictEqual([]);
    expect(deployRegressions([], 0)).toStrictEqual([]);
  });

  it("is silent until both deploys pass MIN_N", () => {
    expect(
      deployRegressions(
        [
          deploy("v1", 100, { p75: 1000, n: 29 }),
          deploy("v2", 200, { p75: 9000 }),
        ],
        0,
      ),
    ).toStrictEqual([]);
    expect(
      deployRegressions(
        [
          deploy("v1", 100, { p75: 1000 }),
          deploy("v2", 200, { p75: 9000, n: 29 }),
        ],
        0,
      ),
    ).toStrictEqual([]);
  });

  it("compares like with like, and judges only what the daily check does", () => {
    expect(
      deployRegressions(
        [
          deploy("v1", 100, { p75: 1000 }),
          deploy("v2", 200, { p75: 9000, device: "wide" }),
          deploy("v2", 200, { p75: 9000, route: "/feed/" }),
          deploy("v1", 100, { metric: "server", device: "5xx", p95: 10 }),
          deploy("v2", 200, { metric: "server", device: "5xx", p95: 9000 }),
          deploy("v1", 100, { metric: "FCP", p75: 10 }),
          deploy("v2", 200, { metric: "FCP", p75: 9000 }),
        ],
        0,
      ),
    ).toStrictEqual([]);
  });
});

/**
 * One window's weeks: this week's row, then one past week per value.
 */
function weeks(now: Partial<Measured>, past: readonly number[]) {
  return [[measured(now)], ...past.map((p75) => [measured({ p75 })])];
}

describe("drifts", () => {
  const usual = [100, 110, 120, 130];
  // median 115, deviations 15/5/5/15, MAD 10: the limit is 115 + 30.

  it("fires on two windows in a row above median + 3 MAD", () => {
    expect(
      drifts(weeks({ p75: 146 }, usual), weeks({ p75: 150 }, usual)),
    ).toStrictEqual([
      {
        check: "drift",
        route: "/closet/",
        metric: "LCP",
        line: "LCP p75 on /closet/ (narrow) has been 146 ms for the last three hours, above the 145 ms usual for these hours (n=40)",
      },
    ]);
  });

  it("is silent at the limit", () => {
    expect(
      drifts(weeks({ p75: 145 }, usual), weeks({ p75: 150 }, usual)),
    ).toStrictEqual([]);
  });

  it("is silent for one noisy window, either one", () => {
    expect(
      drifts(weeks({ p75: 200 }, usual), weeks({ p75: 120 }, usual)),
    ).toStrictEqual([]);
    expect(
      drifts(weeks({ p75: 120 }, usual), weeks({ p75: 200 }, usual)),
    ).toStrictEqual([]);
  });

  it("needs a tenth over the median when the weeks never moved", () => {
    const flat = [100, 100, 100, 100];
    expect(
      drifts(weeks({ p75: 110 }, flat), weeks({ p75: 120 }, flat)),
    ).toStrictEqual([]);
    expect(
      drifts(weeks({ p75: 111 }, flat), weeks({ p75: 120 }, flat)),
    ).toHaveLength(1);
  });

  it("is silent with fewer than three weeks of history, or too few samples", () => {
    const two = [100, 100];
    expect(
      drifts(weeks({ p75: 900 }, two), weeks({ p75: 900 }, two)),
    ).toStrictEqual([]);
    const thin = [
      [measured({ p75: 900 })],
      ...[100, 100, 100].map((p75) => [measured({ p75, n: 29 })]),
    ];
    expect(drifts(thin, thin)).toStrictEqual([]);
    expect(
      drifts(weeks({ p75: 900, n: 29 }, usual), weeks({ p75: 900 }, usual)),
    ).toStrictEqual([]);
  });

  it("speaks with three weeks, and keeps screens apart", () => {
    const three = [100, 100, 100];
    expect(
      drifts(weeks({ p75: 900 }, three), weeks({ p75: 900 }, three)),
    ).toHaveLength(1);
    expect(
      drifts(
        weeks({ p75: 900, route: "/feed/" }, three),
        weeks({ p75: 900, route: "/feed/" }, three),
      ),
    ).toStrictEqual([]);
  });

  it("is silent with nothing measured this week", () => {
    expect(drifts([], [])).toStrictEqual([]);
    // A past week above the others is history, not drift.
    const quiet = [
      [],
      ...[900, 100, 100, 100].map((p75) => [measured({ p75 })]),
    ];
    expect(drifts(quiet, quiet)).toStrictEqual([]);
  });
});

/**
 * A SQL API that answers every query with `rows`, and records what it was
 * asked.
 */
function api(rows: (sql: string) => unknown[]) {
  const asked: string[] = [];
  const query = (sql: string): Promise<unknown> => {
    asked.push(sql);
    return Promise.resolve({ meta: [], data: rows(sql), rows: 0 });
  };
  return { query, asked };
}

// 2026-10-31 13:30:00 UTC, the `:30` firing.
const NOW = Date.UTC(2026, 9, 31, 13, 30) / 1000;
const HOUR = 3600;
const WEEK = 7 * 24 * HOUR;

describe("checkDrift", () => {
  it("asks for the last three whole hours and the three before, for five weeks", async () => {
    const { query, asked } = api(() => []);

    await checkDrift(NOW, query);

    const thirteen = Date.UTC(2026, 9, 31, 13) / 1000;
    const expected = [3, 4].flatMap((back) =>
      [0, 1, 2, 3, 4].map((weeksAgo) => {
        const from = thirteen - back * HOUR - weeksAgo * WEEK;
        return windowQuery(from, from + 3 * HOUR);
      }),
    );
    expect(asked.toSorted((a, b) => a.localeCompare(b))).toStrictEqual(
      expected.toSorted((a, b) => a.localeCompare(b)),
    );
    expect(asked[0]).toContain("toDateTime('2026-10-31 10:00:00', 'Etc/UTC')");
    expect(asked[0]).toContain("toDateTime('2026-10-31 13:00:00', 'Etc/UTC')");
  });

  it("finds drift in what the API answers", async () => {
    const { query } = api((sql) => [
      {
        ...measured({ p75: sql.includes("'2026-10-31 ") ? 900 : 100 }),
        p95: "1",
      },
    ]);
    expect(await checkDrift(NOW, query)).toHaveLength(1);
  });
});

describe("checkDeployRegressions", () => {
  it("asks for a week of deploys and compares the last two", async () => {
    const { query, asked } = api(() => [
      { ...deploy("v1", 100, { p75: 1000 }), firstSeen: "100" },
      {
        ...deploy("v2", 200, { p75: 2000 }),
        firstSeen: "200",
        lastSeen: String(NOW - 3 * HOUR),
      },
    ]);

    const findings = await checkDeployRegressions(NOW, query);

    expect(asked).toStrictEqual([versionQuery(NOW - 7 * 24 * HOUR)]);
    expect(findings).toHaveLength(1);
  });

  it("judges the newest only if it was measured in the last three hours", async () => {
    const { query } = api(() => [
      { ...deploy("v1", 100, { p75: 1000 }), lastSeen: NOW },
      {
        ...deploy("v2", 200, { p75: 2000 }),
        lastSeen: NOW - 3 * HOUR - 1,
      },
    ]);
    expect(await checkDeployRegressions(NOW, query)).toStrictEqual([]);
  });

  it("refuses an answer that does not parse", async () => {
    const { query } = api(() => [{ route: "/closet/" }]);
    await expect(checkDeployRegressions(NOW, query)).rejects.toHaveProperty(
      "name",
      "ZodError",
    );
  });
});

describe("the hourly queries", () => {
  it("read p75, p95 and the weighted count per screen between two times", () => {
    expect(windowQuery(NOW - 1800, NOW + 1800)).toBe(
      [
        "SELECT index1 AS route, blob1 AS metric, blob3 AS device,",
        "quantileExactWeighted(0.75)(double1, _sample_interval) AS p75,",
        "quantileExactWeighted(0.95)(double1, _sample_interval) AS p95,",
        "sum(_sample_interval) AS n",
        "FROM dialed_vitals",
        "WHERE timestamp >= toDateTime('2026-10-31 13:00:00', 'Etc/UTC')",
        "AND timestamp < toDateTime('2026-10-31 14:00:00', 'Etc/UTC')",
        "GROUP BY index1, blob1, blob3",
        "LIMIT 10000",
        "FORMAT JSON",
      ].join("\n"),
    );
  });

  it("read the same per deploy, with when each was first and last measured", () => {
    expect(versionQuery(NOW)).toBe(
      [
        "SELECT index1 AS route, blob1 AS metric, blob3 AS device, blob4 AS version,",
        "quantileExactWeighted(0.75)(double1, _sample_interval) AS p75,",
        "quantileExactWeighted(0.95)(double1, _sample_interval) AS p95,",
        "sum(_sample_interval) AS n,",
        "toUnixTimestamp(min(timestamp)) AS firstSeen,",
        "toUnixTimestamp(max(timestamp)) AS lastSeen",
        "FROM dialed_vitals",
        "WHERE timestamp >= toDateTime('2026-10-31 13:30:00', 'Etc/UTC')",
        "GROUP BY index1, blob1, blob3, blob4",
        "LIMIT 10000",
        "FORMAT JSON",
      ].join("\n"),
    );
  });
});

describe("hourlySpeed", () => {
  it("is silent when unconfigured", async () => {
    const report = vi.fn();
    await expect(
      hourlySpeed(NOW, report, { query: undefined }),
    ).resolves.toBeUndefined();
    expect(report).not.toHaveBeenCalled();
  });

  it("reports what both checks find", async () => {
    const { query } = api((sql) =>
      sql.includes("blob4")
        ? [deploy("v1", 100, { p75: 100 }), deploy("v2", 200, { p75: 900 })]
        : [measured({ p75: sql.includes("'2026-10-31 ") ? 900 : 100 })],
    );
    const report = vi.fn<(finding: SpeedFinding) => void>();

    await hourlySpeed(NOW, report, { query });

    expect(report.mock.calls.map(([finding]) => finding.check)).toStrictEqual([
      "deploy-regression",
      "drift",
    ]);
  });

  it("runs the other check when one fails, then throws its failure", async () => {
    const failure = new Error("SQL API answered 503");
    const query = (sql: string): Promise<unknown> =>
      sql.includes("blob4")
        ? Promise.reject(failure)
        : Promise.resolve({
            data: [measured({ p75: sql.includes("'2026-10-31 ") ? 900 : 100 })],
          });
    const report = vi.fn();

    await expect(hourlySpeed(NOW, report, { query })).rejects.toBe(failure);
    expect(report).toHaveBeenCalledOnce();
  });

  it("asks the configured SQL API by default", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ data: [] })),
    );
    vi.stubGlobal("fetch", fetchImpl);

    await hourlySpeed(NOW, vi.fn());

    expect(fetchImpl).toHaveBeenCalledTimes(11);
  });
});
