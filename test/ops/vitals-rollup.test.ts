import { asc } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { perfDaily } from "../../src/db/schema-ops";
import { opsDb } from "../../src/env";
import {
  BadDayError,
  dailyRollupQuery,
  MAX_ROLLUP_ROWS,
  nextDay,
  VITALS_DATASET,
} from "../../src/modules/ops/vitals-queries";
import {
  daysBefore,
  ROLLUP_DAYS,
  rollupDepsFromEnv,
  rollupVitals,
  type RollupDeps,
} from "../../src/modules/ops/vitals-rollup";

/**
 * The daily speed rollup (design 165, step 6), against the real ops
 * database and a SQL API faked per test.
 */

beforeEach(async () => {
  await opsDb().delete(perfDaily);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function apiRow(route: string, overrides: Record<string, unknown> = {}) {
  return {
    route,
    metric: "LCP",
    device: "narrow",
    p50: 1000,
    p75: 1500,
    p95: 2500,
    n: 40,
    ...overrides,
  };
}

/**
 * A SQL API that answers each day from `byDay`, and records what it was
 * asked.
 */
function fakeApi(byDay: Record<string, unknown>) {
  const asked: string[] = [];
  const query = (sql: string): Promise<unknown> => {
    asked.push(sql);
    const day = /'(\d{4}-\d{2}-\d{2}) 00:00:00'/u.exec(sql)?.[1] ?? "";
    const answer = byDay[day];
    return answer instanceof Error
      ? Promise.reject(answer)
      : Promise.resolve(answer ?? { meta: [], data: [], rows: 0 });
  };
  const deps: RollupDeps = { query, db: opsDb() };
  return { deps, asked };
}

async function stored() {
  return opsDb()
    .select()
    .from(perfDaily)
    .orderBy(asc(perfDaily.day), asc(perfDaily.route), asc(perfDaily.metric));
}

async function storedColumn(column: "day" | "route"): Promise<string[]> {
  const rows = await stored();
  return rows.map((row) => row[column]);
}

function answering(status: number, body: unknown) {
  const fetchImpl = vi.fn<typeof fetch>(() =>
    Promise.resolve(Response.json(body, { status })),
  );
  vi.stubGlobal("fetch", fetchImpl);
  return fetchImpl;
}

describe("dailyRollupQuery", () => {
  it("reads one UTC day's weighted percentiles and count per route, metric and device", () => {
    expect(dailyRollupQuery("2026-10-30")).toBe(
      [
        "SELECT index1 AS route, blob1 AS metric, blob3 AS device,",
        "quantileExactWeighted(0.5)(double1, _sample_interval) AS p50,",
        "quantileExactWeighted(0.75)(double1, _sample_interval) AS p75,",
        "quantileExactWeighted(0.95)(double1, _sample_interval) AS p95,",
        "sum(_sample_interval) AS n",
        "FROM dialed_vitals",
        "WHERE timestamp >= toDateTime('2026-10-30 00:00:00', 'Etc/UTC')",
        "AND timestamp < toDateTime('2026-10-31 00:00:00', 'Etc/UTC')",
        "GROUP BY index1, blob1, blob3",
        "LIMIT 10000",
        "FORMAT JSON",
      ].join("\n"),
    );
    expect(VITALS_DATASET).toBe("dialed_vitals");
    expect(MAX_ROLLUP_ROWS).toBe(10_000);
  });

  it("refuses anything but a day before it reaches the SQL", () => {
    for (const bad of [
      "2026-10-30' OR 1=1 --",
      "2026-1-3",
      "",
      "x2026-10-30",
    ]) {
      expect(() => dailyRollupQuery(bad)).toThrow(BadDayError);
    }
    expect(() => nextDay("2026-10-30\n")).toThrow(
      String.raw`not a UTC day: "2026-10-30\n"`,
    );
    expect(new BadDayError("x").name).toBe("BadDayError");
  });

  it("finds the next day across a month and a year", () => {
    expect(nextDay("2026-10-30")).toBe("2026-10-31");
    expect(nextDay("2026-10-31")).toBe("2026-11-01");
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
  });
});

describe("daysBefore", () => {
  it("counts back from the day before, newest first, across a month", () => {
    expect(daysBefore("2026-03-02", 3)).toStrictEqual([
      "2026-03-01",
      "2026-02-28",
      "2026-02-27",
    ]);
    expect(ROLLUP_DAYS).toBe(3);
  });
});

describe("rollupVitals", () => {
  it("rolls up each of the last three days into perf_daily", async () => {
    const { deps, asked } = fakeApi({
      "2026-10-30": {
        data: [
          apiRow("/closet/"),
          apiRow("/feed/", { metric: "server", device: "2xx" }),
        ],
      },
      "2026-10-28": { data: [apiRow("/runs/$runId", { device: "wide" })] },
    });
    const anomalies: string[] = [];

    await rollupVitals("2026-10-31", anomalies, deps);

    expect(anomalies).toStrictEqual([]);
    expect(asked).toStrictEqual([
      dailyRollupQuery("2026-10-30"),
      dailyRollupQuery("2026-10-29"),
      dailyRollupQuery("2026-10-28"),
    ]);
    expect(await stored()).toStrictEqual([
      { day: "2026-10-28", ...apiRow("/runs/$runId", { device: "wide" }) },
      { day: "2026-10-30", ...apiRow("/closet/") },
      {
        day: "2026-10-30",
        ...apiRow("/feed/", { metric: "server", device: "2xx" }),
      },
    ]);
  });

  it("takes numbers sent as strings", async () => {
    const { deps } = fakeApi({
      "2026-10-30": {
        data: [
          apiRow("/closet/", {
            p50: "999.25",
            p75: "1.5e+3",
            p95: "25e002",
            n: "40",
          }),
        ],
      },
    });

    await rollupVitals("2026-10-31", [], deps);

    expect(await stored()).toStrictEqual([
      {
        day: "2026-10-30",
        ...apiRow("/closet/", { p50: 999.25, p75: 1500 }),
      },
    ]);
  });

  it("refuses a number sent with anything before or after it", async () => {
    const { deps } = fakeApi({
      "2026-10-30": { data: [apiRow("/closet/", { p75: " 1500" })] },
      "2026-10-29": { data: [apiRow("/closet/", { p75: "1500 " })] },
    });
    const anomalies: string[] = [];

    await rollupVitals("2026-10-31", anomalies, deps);

    expect(anomalies).toStrictEqual([
      "speed rollup for 2026-10-30 failed: the SQL API's answer did not parse",
      "speed rollup for 2026-10-29 failed: the SQL API's answer did not parse",
    ]);
    expect(await stored()).toStrictEqual([]);
  });

  it("replaces a day on a re-run, dropping a row the new answer lacks", async () => {
    const first = fakeApi({
      "2026-10-30": { data: [apiRow("/closet/"), apiRow("/feed/")] },
    });
    await rollupVitals("2026-10-31", [], first.deps);
    const again = fakeApi({
      "2026-10-30": { data: [apiRow("/closet/", { p50: 900 })] },
    });

    await rollupVitals("2026-10-31", [], again.deps);
    await rollupVitals("2026-10-31", [], again.deps);

    expect(await stored()).toStrictEqual([
      { day: "2026-10-30", ...apiRow("/closet/", { p50: 900 }) },
    ]);
  });

  it("leaves other days alone when it replaces one", async () => {
    await opsDb()
      .insert(perfDaily)
      .values({ day: "2026-10-01", ...apiRow("/closet/") });
    const { deps } = fakeApi({});

    await rollupVitals("2026-10-31", [], deps);

    expect(await stored()).toStrictEqual([
      { day: "2026-10-01", ...apiRow("/closet/") },
    ]);
  });

  it("writes more rows than one insert may bind", async () => {
    const routes = Array.from(
      { length: 25 },
      (_, index) => `/r${String(index)}`,
    );
    const { deps } = fakeApi({
      "2026-10-30": { data: routes.map((route) => apiRow(route)) },
    });

    await rollupVitals("2026-10-31", [], deps);

    expect(await storedColumn("route")).toStrictEqual(
      routes.toSorted((a, b) => a.localeCompare(b)),
    );
  });

  it("reports a day the API could not answer, and rolls up the others", async () => {
    const { deps } = fakeApi({
      "2026-10-30": { data: [apiRow("/closet/")] },
      "2026-10-29": new Error("Analytics Engine SQL API answered 503"),
      "2026-10-28": { data: [apiRow("/feed/")] },
    });
    const anomalies: string[] = [];

    await rollupVitals("2026-10-31", anomalies, deps);

    expect(anomalies).toStrictEqual([
      "speed rollup for 2026-10-29 failed: Analytics Engine SQL API answered 503",
    ]);
    expect(await storedColumn("day")).toStrictEqual([
      "2026-10-28",
      "2026-10-30",
    ]);
  });

  it("names an answer that does not parse without quoting it, and keeps the day it had", async () => {
    await opsDb()
      .insert(perfDaily)
      .values({ day: "2026-10-30", ...apiRow("/closet/") });
    const { deps } = fakeApi({
      "2026-10-30": { data: [apiRow("/closet/", { p50: "secret-ish" })] },
      "2026-10-29": { rows: 0 },
      "2026-10-28": { data: [apiRow("/feed/", { n: 1.5 })] },
    });
    const anomalies: string[] = [];

    await rollupVitals("2026-10-31", anomalies, deps);

    expect(anomalies).toStrictEqual([
      "speed rollup for 2026-10-30 failed: the SQL API's answer did not parse",
      "speed rollup for 2026-10-29 failed: the SQL API's answer did not parse",
      "speed rollup for 2026-10-28 failed: the SQL API's answer did not parse",
    ]);
    expect(await stored()).toStrictEqual([
      { day: "2026-10-30", ...apiRow("/closet/") },
    ]);
  });

  it("refuses a negative count, an empty route and an over-long one", async () => {
    const { deps } = fakeApi({
      "2026-10-30": { data: [apiRow("/closet/", { n: -1 })] },
      "2026-10-29": { data: [apiRow("")] },
      "2026-10-28": { data: [apiRow(`/${"a".repeat(96)}`)] },
    });
    const anomalies: string[] = [];

    await rollupVitals("2026-10-31", anomalies, deps);

    expect(anomalies).toHaveLength(3);
    expect(await stored()).toStrictEqual([]);
  });

  it("accepts a 96-character route, the index's limit", async () => {
    const route = `/${"a".repeat(95)}`;
    const { deps } = fakeApi({ "2026-10-30": { data: [apiRow(route)] } });
    const anomalies: string[] = [];

    await rollupVitals("2026-10-31", anomalies, deps);

    expect(anomalies).toStrictEqual([]);
    expect(await storedColumn("route")).toStrictEqual([route]);
  });

  it("says so, once, when it is not configured, and touches nothing", async () => {
    const anomalies: string[] = [];

    await rollupVitals("2026-10-31", anomalies, {
      query: undefined,
      db: opsDb(),
    });

    expect(anomalies).toStrictEqual([
      "speed rollup: CF_ACCOUNT_ID or ANALYTICS_SQL_TOKEN is not set, so no day was rolled up",
    ]);
    expect(await stored()).toStrictEqual([]);
  });

  it("names a thrown non-error as unknown", async () => {
    const anomalies: string[] = [];
    await rollupVitals("2026-10-31", anomalies, {
      query: vi
        .fn<(sql: string) => Promise<unknown>>()
        .mockRejectedValue("nope"),
      db: opsDb(),
    });
    expect(anomalies[0]).toBe(
      "speed rollup for 2026-10-30 failed: an unknown error",
    );
  });
});

describe("rollupDepsFromEnv", () => {
  it("is unconfigured without an account or a token", () => {
    expect(rollupDepsFromEnv({}).query).toBeUndefined();
    expect(
      rollupDepsFromEnv({ CF_ACCOUNT_ID: "", ANALYTICS_SQL_TOKEN: "t" }).query,
    ).toBeUndefined();
    expect(
      rollupDepsFromEnv({ CF_ACCOUNT_ID: "a", ANALYTICS_SQL_TOKEN: "" }).query,
    ).toBeUndefined();
    expect(rollupDepsFromEnv({ CF_ACCOUNT_ID: "a" }).query).toBeUndefined();
    expect(
      rollupDepsFromEnv({ ANALYTICS_SQL_TOKEN: "t" }).query,
    ).toBeUndefined();
  });

  it("posts the SQL to the account's endpoint with the token, bounded", async () => {
    const fetchImpl = answering(200, { data: [] });
    const { query } = rollupDepsFromEnv();

    await expect(query?.("SELECT 1")).resolves.toStrictEqual({ data: [] });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/test-account/analytics_engine/sql",
    );
    expect(init?.method).toBe("POST");
    expect(init?.headers).toStrictEqual({ authorization: "Bearer test-token" });
    expect(init?.body).toBe("SELECT 1");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("escapes the account into the path", async () => {
    const fetchImpl = answering(200, { data: [] });
    await rollupDepsFromEnv({
      CF_ACCOUNT_ID: "a/b",
      ANALYTICS_SQL_TOKEN: "t",
    }).query?.("SELECT 1");
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      "https://api.cloudflare.com/client/v4/accounts/a%2Fb/analytics_engine/sql",
    );
  });

  it("refuses an error status by its number alone", async () => {
    answering(503, { errors: ["SELECT secret"] });
    const query = rollupDepsFromEnv().query;
    const attempt = query?.("SELECT 1");
    await expect(attempt).rejects.toBeInstanceOf(Error);
    await expect(attempt).rejects.toHaveProperty(
      "message",
      "Analytics Engine SQL API answered 503",
    );
  });

  it("writes to the ops database", () => {
    expect(rollupDepsFromEnv().db).toBeDefined();
  });
});
