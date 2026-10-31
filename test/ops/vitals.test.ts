import { describe, expect, it } from "vitest";

import {
  MAX_METRICS_PER_BEACON,
  VITAL_METRICS,
  VITAL_METRIC_NAMES,
  vitalsPayloadSchema,
} from "../../src/lib/contracts/vitals";
import { toDataPoints } from "../../src/modules/ops/vitals";

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

const LONGEST_ROUTE = `/${"a".repeat(119)}`;
const TOO_LONG_ROUTE = `/${"a".repeat(120)}`;

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
