import { afterEach, describe, expect, it, vi } from "vitest";

import { env } from "../../src/env";
import {
  MAX_METRICS_PER_BEACON,
  VITAL_METRICS,
  VITAL_METRIC_NAMES,
  vitalsPayloadSchema,
} from "../../src/lib/contracts/vitals";
import {
  MAX_VITALS_BYTES,
  receiveVitals,
  recordServerTiming,
  serverDataPoint,
  toDataPoints,
  vitalsDepsFromEnv,
  type VitalsDeps,
  type VitalsRefusalLine,
} from "../../src/modules/ops/vitals";

/**
 * Design 165's beacon: the payload the endpoint accepts, and the data
 * points it becomes. The endpoint is public, so every bound here is one a
 * stranger will try.
 */

const lcp = { name: "LCP", value: 2400, parts: [300, 200, 1500, 400] };

const payload = (overrides: Record<string, unknown> = {}) => ({
  route: "/runs/$runId",
  navigationType: "navigate",
  device: "narrow",
  metrics: [lcp],
  ...overrides,
});

afterEach(() => {
  vi.restoreAllMocks();
});

const parse = (value: unknown) => vitalsPayloadSchema.safeParse(value);

/**
Whether the beacon with these fields changed would be accepted.
*/
const isAccepted = (overrides: Record<string, unknown> = {}): boolean =>
  parse(payload(overrides)).success;

/**
Whether a beacon carrying only this one metric would be accepted.
*/
const isAcceptedMetric = (metric: Record<string, unknown>): boolean =>
  isAccepted({ metrics: [metric] });

/**
The messages of a refused one-metric beacon, naming the rule that refused it.
*/
function refusals(metric: Record<string, unknown>): string[] {
  const result = parse(payload({ metrics: [metric] }));
  expect(result.success).toBe(false);
  return result.error?.issues.map((issue) => issue.message) ?? [];
}

/**
The index Analytics Engine keeps is at most 96 bytes.
*/
const LONGEST_ROUTE = `/${"a".repeat(95)}`;
const TOO_LONG_ROUTE = `/${"a".repeat(96)}`;

const navs = (count: number) =>
  Array.from({ length: count }, () => ({ name: "nav", value: 1 }));

const partsFor = (name: (typeof VITAL_METRIC_NAMES)[number]) =>
  VITAL_METRICS[name].parts.map(() => 1);

describe("vitalsPayloadSchema", () => {
  it("accepts a beacon the client sends, unchanged", () => {
    expect(parse(payload()).data).toEqual(payload());
  });

  it("accepts every metric, navigation type and device width it names", () => {
    for (const name of VITAL_METRIC_NAMES) {
      expect(
        isAcceptedMetric({ name, value: 1, parts: partsFor(name) }),
        name,
      ).toBe(true);
    }
    const types = [
      "navigate",
      "reload",
      "back-forward",
      "back-forward-cache",
      "prerender",
      "restore",
      "soft",
    ];
    for (const navigationType of types) {
      expect(isAccepted({ navigationType }), navigationType).toBe(true);
    }
    expect(isAccepted({ device: "wide" })).toBe(true);
  });

  it("gives a metric with no parts an empty list", () => {
    const result = parse(payload({ metrics: [{ name: "CLS", value: 0.1 }] }));
    expect(result.data?.metrics).toEqual([
      { name: "CLS", value: 0.1, parts: [] },
    ]);
  });

  it("refuses any field it does not name, at either level", () => {
    expect(isAccepted({ url: "https://dialed.run/runs/abc" })).toBe(false);
    expect(isAcceptedMetric({ ...lcp, userId: "u1" })).toBe(false);
  });

  it("refuses a missing field", () => {
    for (const key of ["route", "navigationType", "device", "metrics"]) {
      const rest = Object.fromEntries(
        Object.entries(payload()).filter(([field]) => field !== key),
      );
      expect(parse(rest).success, key).toBe(false);
    }
  });

  it("refuses names it does not know", () => {
    expect(isAcceptedMetric({ name: "FID", value: 1 })).toBe(false);
    expect(isAccepted({ navigationType: "teleport" })).toBe(false);
    expect(isAccepted({ device: "tablet" })).toBe(false);
  });

  it("takes a route id's shape, not a URL's", () => {
    const good = [
      "/",
      "/runs/$runId",
      "/@{$handle}",
      "/feed/photo/$",
      "/open-source",
      "/a_b.c",
      LONGEST_ROUTE,
    ];
    for (const route of good) {
      expect(isAccepted({ route }), route).toBe(true);
    }
    const bad = [
      "",
      "runs",
      "/runs?x=1",
      "/runs#a",
      "/a b",
      "https://x.y/",
      "/é",
      "x/runs",
      TOO_LONG_ROUTE,
    ];
    for (const route of bad) {
      expect(isAccepted({ route }), route).toBe(false);
    }
  });

  it("holds each value to its metric's range", () => {
    expect(refusals({ name: "CLS", value: 10.01 })).toEqual([
      "value out of range",
    ]);
    expect(isAcceptedMetric({ name: "CLS", value: 10 })).toBe(true);
    const inp = { name: "INP", parts: [1, 1, 1] };
    expect(isAcceptedMetric({ ...inp, value: 60_000 })).toBe(true);
    expect(refusals({ ...inp, value: 60_001 })).toEqual(["value out of range"]);
    expect(isAcceptedMetric({ name: "nav", value: 0 })).toBe(true);
    for (const value of [-1, NaN, Infinity, "5"]) {
      expect(isAcceptedMetric({ name: "nav", value }), String(value)).toBe(
        false,
      );
    }
  });

  it("wants exactly the parts its metric has, each in range", () => {
    const mismatch = ["parts do not match the metric"];
    expect(refusals({ ...lcp, parts: [1, 2, 3] })).toEqual(mismatch);
    expect(refusals({ ...lcp, parts: [1, 2, 3, 4, 5] })).toEqual(mismatch);
    expect(refusals({ name: "CLS", value: 0, parts: [1] })).toEqual(mismatch);
    expect(refusals({ ...lcp, parts: [1, 2, 3, 120_001] })).toEqual(mismatch);
    expect(refusals({ ...lcp, parts: [120_001, 2, 3, 4] })).toEqual(mismatch);
    expect(isAcceptedMetric({ ...lcp, parts: [1, 2, 3, 120_000] })).toBe(true);
    expect(isAcceptedMetric({ ...lcp, parts: [1, 2, 3, -4] })).toBe(false);
  });

  it("carries one metric at least and the cap at most", () => {
    expect(MAX_METRICS_PER_BEACON).toBe(20);
    expect(isAccepted({ metrics: [] })).toBe(false);
    expect(isAccepted({ metrics: navs(MAX_METRICS_PER_BEACON) })).toBe(true);
    expect(isAccepted({ metrics: navs(MAX_METRICS_PER_BEACON + 1) })).toBe(
      false,
    );
  });
});

describe("toDataPoints", () => {
  it("writes one data point per metric, indexed by route, in the dataset's layout", () => {
    const parsed = vitalsPayloadSchema.parse(
      payload({
        device: "wide",
        navigationType: "soft",
        metrics: [lcp, { name: "nav", value: 850 }],
      }),
    );
    expect(toDataPoints(parsed, "v-123")).toEqual([
      {
        indexes: ["/runs/$runId"],
        blobs: ["LCP", "soft", "wide", "v-123"],
        doubles: [2400, 300, 200, 1500, 400],
      },
      {
        indexes: ["/runs/$runId"],
        blobs: ["nav", "soft", "wide", "v-123"],
        doubles: [850],
      },
    ]);
  });
});

/**
 * A dataset, log and Sentry that keep what they are given.
 */
function fakeDeps(write?: VitalsDeps["write"]): VitalsDeps & {
  points: AnalyticsEngineDataPoint[];
  lines: VitalsRefusalLine[];
  reports: unknown[];
} {
  const points: AnalyticsEngineDataPoint[] = [];
  const lines: VitalsRefusalLine[] = [];
  const reports: unknown[] = [];
  return {
    write:
      write ??
      ((point) => {
        points.push(point);
      }),
    version: "v-9",
    log: (line) => {
      lines.push(line);
    },
    report: (error) => {
      reports.push(error);
    },
    points,
    lines,
    reports,
  };
}

/**
 * A beacon as `sendBeacon` posts it from our own page.
 */
function beacon(
  body: BodyInit | null,
  headers?: Record<string, string>,
): Request {
  return new Request("https://dialed.test/api/vitals", {
    method: "POST",
    headers: headers ?? { "sec-fetch-site": "same-origin" },
    body,
  });
}

/**
 * A same-origin beacon carrying the payload with these fields changed.
 */
const sent = (overrides: Record<string, unknown> = {}) =>
  beacon(JSON.stringify(payload(overrides)));

async function received(request: Request, deps = fakeDeps()) {
  const response = await receiveVitals(request, deps);
  expect(response.status).toBe(204);
  expect(await response.text()).toBe("");
  return deps;
}

describe("receiveVitals", () => {
  it("writes each metric as a data point stamped with the deploy, and logs nothing", async () => {
    const deps = await received(
      sent({ metrics: [lcp, { name: "nav", value: 9 }] }),
    );
    expect(deps.points).toEqual([
      {
        indexes: ["/runs/$runId"],
        blobs: ["LCP", "navigate", "narrow", "v-9"],
        doubles: [2400, 300, 200, 1500, 400],
      },
      {
        indexes: ["/runs/$runId"],
        blobs: ["nav", "navigate", "narrow", "v-9"],
        doubles: [9],
      },
    ]);
    expect(deps.lines).toEqual([]);
  });

  it("drops a beacon from anywhere but our own pages, unread", async () => {
    for (const headers of [
      {},
      { "sec-fetch-site": "cross-site" },
      { "sec-fetch-site": "same-site" },
      { "sec-fetch-site": "none" },
    ]) {
      const request = beacon(JSON.stringify(payload()), headers);
      const deps = await received(request);
      expect(deps.points, JSON.stringify(headers)).toEqual([]);
      expect(deps.lines).toEqual([
        { kind: "vitals-refused", reason: "cross-site" },
      ]);
      expect(request.bodyUsed).toBe(false);
    }
  });

  it("drops a body past the cap, and takes one at it", async () => {
    const over = await received(beacon("x".repeat(MAX_VITALS_BYTES + 1)));
    expect(over.lines).toEqual([
      { kind: "vitals-refused", reason: "too-large" },
    ]);
    const json = JSON.stringify(payload());
    const atCap = await received(beacon(json.padEnd(MAX_VITALS_BYTES, " ")));
    expect(atCap.lines).toEqual([]);
    expect(atCap.points).toHaveLength(1);
  });

  it("drops a body that is not JSON, or not a beacon", async () => {
    const cases = [
      ["{", "not-json"],
      ["", "not-json"],
      ["null", "invalid"],
      [JSON.stringify(payload({ device: "tablet" })), "invalid"],
    ] as const;
    for (const [body, reason] of cases) {
      const deps = await received(beacon(body));
      expect(deps.lines, body).toEqual([{ kind: "vitals-refused", reason }]);
      expect(deps.points).toEqual([]);
    }
  });

  it("drops a body that breaks while being read", async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("client went away"));
      },
    });
    const deps = await received(beacon(body));
    expect(deps.lines).toEqual([
      { kind: "vitals-refused", reason: "unreadable" },
    ]);
    expect(deps.reports).toEqual([]);
  });

  it("reports a dataset that throws, and still answers 204", async () => {
    const failure = new Error("binding down");
    const deps = await received(
      sent(),
      fakeDeps(() => {
        throw failure;
      }),
    );
    expect(deps.reports).toEqual([failure]);
    expect(deps.lines).toEqual([
      { kind: "vitals-refused", reason: "write-failed" },
    ]);
  });
});

function nothing(): void {
  /*
   * A silenced console: the call is what the test reads.
   */
}

describe("vitalsDepsFromEnv", () => {
  it("writes to the dataset and stamps the version the bindings give", () => {
    const points: AnalyticsEngineDataPoint[] = [];
    const deps = vitalsDepsFromEnv({
      VITALS: {
        writeDataPoint: (point) => {
          if (point !== undefined) points.push(point);
        },
      },
      CF_VERSION_METADATA: { id: "abc-123" },
    });
    const point = { indexes: ["/"], blobs: ["nav"], doubles: [1] };
    deps.write(point);
    expect(points).toEqual([point]);
    expect(deps.version).toBe("abc-123");
  });

  it("logs a refusal as an object and reports to Sentry as the vitals surface", () => {
    const log = vi.spyOn(console, "log").mockImplementation(nothing);
    const error = vi.spyOn(console, "error").mockImplementation(nothing);
    const deps = vitalsDepsFromEnv();
    const line: VitalsRefusalLine = {
      kind: "vitals-refused",
      reason: "invalid",
    };
    deps.log(line);
    expect(log).toHaveBeenCalledWith(line);
    const failure = new Error("x");
    deps.report(failure);
    expect(error).toHaveBeenCalledWith(
      "[sentry-disabled]",
      { surface: "vitals" },
      failure,
    );
  });

  it("reads the Worker's own bindings by default", () => {
    // Law 10: the pool binds them as wrangler.jsonc does, so this is the
    // shape production hands the endpoint.
    const deps = vitalsDepsFromEnv();
    expect(deps.version).toBe(env.CF_VERSION_METADATA.id);
    expect(typeof deps.version).toBe("string");
    expect(() => {
      deps.write({ indexes: ["/"], blobs: ["nav"], doubles: [1] });
    }).not.toThrow();
  });
});

describe("serverDataPoint", () => {
  const timing = { route: "/runs/$runId", method: "POST", status: 201, ms: 87 };

  it("writes a server point: method, status class and deploy in the blobs, ms in the double", () => {
    expect(serverDataPoint(timing, "v-3")).toEqual({
      indexes: ["/runs/$runId"],
      blobs: ["server", "POST", "2xx", "v-3"],
      doubles: [87],
    });
  });

  it("names each status by its class", () => {
    const classes = [100, 200, 299, 301, 404, 499, 500, 503].map(
      (status) => serverDataPoint({ ...timing, status }, "v").blobs?.[2],
    );
    expect(classes).toEqual([
      "1xx",
      "2xx",
      "2xx",
      "3xx",
      "4xx",
      "4xx",
      "5xx",
      "5xx",
    ]);
  });

  it("cuts an index to the 96 bytes Analytics Engine keeps", () => {
    const long = `serverFn:${"a".repeat(120)}`;
    expect(serverDataPoint({ ...timing, route: long }, "v").indexes).toEqual([
      long.slice(0, 96),
    ]);
    const exact = "b".repeat(96);
    expect(serverDataPoint({ ...timing, route: exact }, "v").indexes).toEqual([
      exact,
    ]);
  });
});

describe("recordServerTiming", () => {
  const timing = { route: "/", method: "GET", status: 200, ms: 5 };

  it("writes the server point with the deploy's version", () => {
    const deps = fakeDeps();
    recordServerTiming(timing, deps);
    expect(deps.points).toEqual([serverDataPoint(timing, "v-9")]);
    expect(deps.reports).toEqual([]);
  });

  it("reports a dataset that throws, and does not throw itself", () => {
    const failure = new Error("binding down");
    const deps = fakeDeps(() => {
      throw failure;
    });
    expect(() => {
      recordServerTiming(timing, deps);
    }).not.toThrow();
    expect(deps.reports).toEqual([failure]);
  });

  it("writes to the Worker's own dataset by default", () => {
    const write = vi.spyOn(env.VITALS, "writeDataPoint");
    recordServerTiming(timing);
    expect(write).toHaveBeenCalledWith(
      serverDataPoint(timing, env.CF_VERSION_METADATA.id),
    );
  });
});
