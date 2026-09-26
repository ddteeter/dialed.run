import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { env } from "../../src/env";
import { checkHealth } from "../../src/modules/ops";
import { nowSeconds } from "../../src/lib/now";

/**
 * `/health` is read by whatever restarts or pages when this app is down,
 * so the answer that matters is the *unhealthy* one — and nothing ever
 * asked for it. Every mutant here survived on the happy path: the three
 * checks could start life as `"ok"` instead of `"failed"`, and `every`
 * could become `some`, and a report saying `ok: true` with two dead
 * databases would have passed.
 */

// Every case starts from a configured deployment, so a binding failure is
// the only thing making a report unhealthy — the configuration cases below
// take the var away themselves.
const CONFIGURED_URL: unknown = env.BETTER_AUTH_URL;

beforeEach(() => {
  Reflect.set(env, "BETTER_AUTH_URL", "https://dialed.test");
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.set(env, "BETTER_AUTH_URL", CONFIGURED_URL);
});

describe("checkHealth when something is down", () => {
  it("fails the whole report when the core database is unreachable", async () => {
    // `some` instead of `every` is the mutant this catches: two working
    // bindings would carry a dead one.
    vi.spyOn(env.DIALED_CORE, "prepare").mockImplementation(() => {
      throw new Error("D1 unreachable");
    });

    const report = await checkHealth();

    expect(report.checks.coreDb).toBe("failed");
    expect(report.checks.weatherDb).toBe("ok");
    expect(report.ok).toBe(false);
  });

  it("fails the whole report when the weather database is unreachable", async () => {
    vi.spyOn(env.DIALED_WEATHER, "prepare").mockImplementation(() => {
      throw new Error("D1 unreachable");
    });

    const report = await checkHealth();

    expect(report.checks.weatherDb).toBe("failed");
    expect(report.checks.coreDb).toBe("ok");
    expect(report.ok).toBe(false);
  });

  it("fails the whole report when media storage is unreachable", async () => {
    vi.spyOn(env.MEDIA, "head").mockRejectedValue(new Error("R2 unreachable"));

    const report = await checkHealth();

    expect(report.checks.media).toBe("failed");
    expect(report.ok).toBe(false);
  });

  it("reports every failure at once rather than stopping at the first", async () => {
    // A restart loop wants the whole picture; a report that gives up after
    // the first failure makes the second look healthy.
    vi.spyOn(env.DIALED_CORE, "prepare").mockImplementation(() => {
      throw new Error("D1 unreachable");
    });
    vi.spyOn(env.MEDIA, "head").mockRejectedValue(new Error("R2 unreachable"));

    const report = await checkHealth();

    expect(report.checks).toStrictEqual({
      coreDb: "failed",
      weatherDb: "ok",
      media: "failed",
    });
  });
});

describe("what a healthy report says", () => {
  it("stamps `at` in epoch seconds, not milliseconds", async () => {
    const before = nowSeconds();

    const report = await checkHealth();

    expect(report.at).toBeGreaterThanOrEqual(before - 5);
    expect(report.at).toBeLessThanOrEqual(before + 5);
  });
});

describe("required configuration (OPS-4)", () => {
  const ORIGINAL: unknown = env.BETTER_AUTH_URL;

  afterEach(() => {
    Reflect.set(env, "BETTER_AUTH_URL", ORIGINAL);
  });

  it("names a missing BETTER_AUTH_URL, and is not healthy without it", async () => {
    Reflect.deleteProperty(env, "BETTER_AUTH_URL");

    const report = await checkHealth();

    expect(report.missing).toStrictEqual(["BETTER_AUTH_URL"]);
    expect(report.ok).toBe(false);
  });

  it("treats an empty BETTER_AUTH_URL as missing", async () => {
    Reflect.set(env, "BETTER_AUTH_URL", "");

    const report = await checkHealth();

    expect(report.missing).toStrictEqual(["BETTER_AUTH_URL"]);
  });

  it("is healthy with every binding up and nothing missing", async () => {
    Reflect.set(env, "BETTER_AUTH_URL", "https://dialed.run");

    const report = await checkHealth();

    expect(report.missing).toStrictEqual([]);
    expect(report.checks).toStrictEqual({
      coreDb: "ok",
      weatherDb: "ok",
      media: "ok",
    });
    expect(report.ok).toBe(true);
  });
});
