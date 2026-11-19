import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cronCheckpoints } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { healthResponse } from "../../src/modules/ops/desk";
import {
  deploymentConfig,
  isNamedByDigest,
} from "../../src/modules/ops/desk/deployment-config";
import {
  checkDeploymentConfig,
  checkHealth,
} from "../../src/modules/ops/desk/health";
import { cronPeriods } from "../../src/modules/ops/desk/crons";
import { nowSeconds } from "../../src/lib/now";

/**
 * `/health` is read by whatever pages when this app is down — an uptime
 * check; nothing restarts a Worker on its answer —
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

  it("names the Worker version that answered, for a deploy's smoke test (design 186)", async () => {
    const report = await checkHealth();

    expect(report.version).toBe(env.CF_VERSION_METADATA.id);
    expect(report.version).not.toBe("");
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

describe("the unsubscribe secret (task 126)", () => {
  const ORIGINAL: unknown = env.UNSUBSCRIBE_SECRET;

  afterEach(() => {
    Reflect.set(env, "UNSUBSCRIBE_SECRET", ORIGINAL);
  });

  it("names a missing UNSUBSCRIBE_SECRET, and is not healthy without it", async () => {
    Reflect.deleteProperty(env, "UNSUBSCRIBE_SECRET");

    const report = await checkHealth();

    expect(report.missing).toStrictEqual(["UNSUBSCRIBE_SECRET"]);
    expect(report.ok).toBe(false);
  });
});

describe("the auth signing secret", () => {
  const ORIGINAL: unknown = env.BETTER_AUTH_SECRET;

  afterEach(() => {
    Reflect.set(env, "BETTER_AUTH_SECRET", ORIGINAL);
  });

  it("names a missing BETTER_AUTH_SECRET, and is not healthy without it", async () => {
    Reflect.deleteProperty(env, "BETTER_AUTH_SECRET");

    const report = await checkHealth();

    expect(report.missing).toStrictEqual(["BETTER_AUTH_SECRET"]);
    expect(report.ok).toBe(false);
  });
});

const HOUR = 3600;
const NOW = 1_800_000_000;

async function lastRan(cronName: string, at: number): Promise<void> {
  await drizzle(env.DIALED_CORE)
    .insert(cronCheckpoints)
    .values({ cronName, lastRunAt: at });
}

describe("crons that have stopped (design 162)", () => {
  beforeEach(async () => {
    await drizzle(env.DIALED_CORE).delete(cronCheckpoints);
    vi.spyOn(Date, "now").mockReturnValue(NOW * 1000);
  });

  it("reads each cron's period from its schedule", () => {
    expect(cronPeriods).toStrictEqual([
      { name: "daily-digest", periodS: 24 * HOUR },
      { name: "weather-retry", periodS: HOUR },
      { name: "enrichment-retry", periodS: HOUR },
      { name: "screening-retry", periodS: HOUR },
    ]);
  });

  it("names a cron two periods behind, and is not healthy", async () => {
    await lastRan("weather-retry", NOW - 2 * HOUR - 1);
    // Exactly two periods is one firing late, not stopped.
    await lastRan("enrichment-retry", NOW - 2 * HOUR);
    await lastRan("daily-digest", NOW - 47 * HOUR);
    // Never ran: a fresh deployment, not a stopped cron.

    const report = await checkHealth();

    expect(report.staleCrons).toStrictEqual(["weather-retry"]);
    expect(report.ok).toBe(false);
  });

  it("names a daily cron two days behind", async () => {
    await lastRan("daily-digest", NOW - 48 * HOUR - 1);

    const report = await checkHealth();

    expect(report.staleCrons).toStrictEqual(["daily-digest"]);
  });

  it("ignores a heartbeat row that is not a cron", async () => {
    // The digest's own marks share the table.
    await lastRan("unknown", NOW - 100 * HOUR);

    const report = await checkHealth();

    expect(report.staleCrons).toStrictEqual([]);
    expect(report.ok).toBe(true);
  });

  it("leaves staleness to the database check when it cannot read", async () => {
    vi.spyOn(env.DIALED_CORE, "prepare").mockImplementation(() => {
      throw new Error("D1 unreachable");
    });

    const report = await checkHealth();

    expect(report.staleCrons).toStrictEqual([]);
    expect(report.checks.coreDb).toBe("failed");
  });
});

/**
 * Set one deployment value for a test, and put it back after.
 */
function withValue(name: string, value: string | undefined): () => void {
  const original: unknown = Reflect.get(env, name);
  if (value === undefined) Reflect.deleteProperty(env, name);
  else Reflect.set(env, name, value);
  return () => {
    Reflect.set(env, name, original);
  };
}

describe("every deployment value, set or missing (design 237)", () => {
  it("names every value in the list, and only those", async () => {
    const report = await checkHealth();

    expect(Object.keys(report.config)).toStrictEqual(
      deploymentConfig.map((value) => value.name),
    );
  });

  it("says set or missing, never the value", async () => {
    const restore = [
      withValue("TAKEDOWN_SECRET", "a-value-health-must-not-print"),
      withValue("CLOSED_ADDRESS_SECRET", undefined),
      withValue("GOOGLE_CLIENT_ID", ""),
    ];
    try {
      const report = await checkHealth();

      expect(report.config.TAKEDOWN_SECRET).toBe("set");
      expect(report.config.CLOSED_ADDRESS_SECRET).toBe("missing");
      // Empty is missing, as `missing` has always read it.
      expect(report.config.GOOGLE_CLIENT_ID).toBe("missing");
      expect(JSON.stringify(report)).not.toContain(
        "a-value-health-must-not-print",
      );
    } finally {
      for (const undo of restore) undo();
    }
  });

  it("stays healthy when a value that does not fail health is missing", async () => {
    const restore = withValue("TAKEDOWN_SECRET", undefined);
    try {
      const report = await checkHealth();

      expect(report.config.TAKEDOWN_SECRET).toBe("missing");
      expect(report.missing).toStrictEqual([]);
      expect(report.ok).toBe(true);
    } finally {
      restore();
    }
  });
});

describe("who is told why (owner, 2026-11-17)", () => {
  const OPERATOR = "operator-health";
  const AT = 1_800_000_000;

  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(AT * 1000);
  });

  it("answers a stranger with ok, version and at, and nothing else", async () => {
    const restore = withValue("ADMIN_USER_IDS", OPERATOR);
    try {
      const response = await healthResponse("someone-else");
      const body: unknown = await response.json();

      expect(response.status).toBe(200);
      expect(body).toStrictEqual({
        ok: true,
        version: env.CF_VERSION_METADATA.id,
        at: AT,
      });
    } finally {
      restore();
    }
  });

  it("answers a signed-out viewer as a stranger, even with no operators", async () => {
    const restore = withValue("ADMIN_USER_IDS", undefined);
    try {
      const response = await healthResponse("");
      const body: unknown = await response.json();

      expect(body).toStrictEqual({
        ok: true,
        version: env.CF_VERSION_METADATA.id,
        at: AT,
      });
    } finally {
      restore();
    }
  });

  it("answers a stranger 503 when unhealthy, without saying why", async () => {
    const restore = [
      withValue("ADMIN_USER_IDS", OPERATOR),
      withValue("UNSUBSCRIBE_SECRET", undefined),
    ];
    try {
      const response = await healthResponse("someone-else");
      const body: unknown = await response.json();

      expect(response.status).toBe(503);
      expect(body).toMatchObject({ ok: false });
      expect(JSON.stringify(body)).not.toContain("UNSUBSCRIBE_SECRET");
    } finally {
      for (const undo of restore) undo();
    }
  });

  it("tells an operator everything", async () => {
    const restore = [
      withValue("ADMIN_USER_IDS", OPERATOR),
      withValue("UNSUBSCRIBE_SECRET", undefined),
    ];
    try {
      const response = await healthResponse(OPERATOR);
      const body: unknown = await response.json();

      expect(response.status).toBe(503);
      expect(body).toMatchObject({
        ok: false,
        checks: { coreDb: "ok", weatherDb: "ok", media: "ok" },
        missing: ["UNSUBSCRIBE_SECRET"],
        staleCrons: [],
        version: env.CF_VERSION_METADATA.id,
        config: { UNSUBSCRIBE_SECRET: "missing", ADMIN_USER_IDS: "set" },
      });
    } finally {
      for (const undo of restore) undo();
    }
  });
});

describe("the digest's config lines (design 237)", () => {
  it("names a missing value the plan needs, with its level", () => {
    const restore = withValue("CLOSED_ADDRESS_SECRET", undefined);
    try {
      const lines: string[] = [];

      checkDeploymentConfig(lines);

      expect(lines).toContain(
        "CLOSED_ADDRESS_SECRET is not set (deployment plan §2: before friends)",
      );
    } finally {
      restore();
    }
  });

  it("leaves out a missing value that is optional, owner-only or for Strava", () => {
    const restore = [
      withValue("GOOGLE_CLIENT_ID", undefined),
      withValue("GARMIN_API_KEY", undefined),
      withValue("STRAVA_CLIENT_ID", undefined),
    ];
    try {
      const lines: string[] = [];

      checkDeploymentConfig(lines);

      expect(lines.join("\n")).not.toMatch(
        /GOOGLE_CLIENT_ID|GARMIN_API_KEY|STRAVA_CLIENT_ID/u,
      );
    } finally {
      for (const undo of restore) undo();
    }
  });

  it("never names SENTRY_DSN, which is how its lines would travel", () => {
    const restore = withValue("SENTRY_DSN", undefined);
    try {
      const lines: string[] = [];

      checkDeploymentConfig(lines);

      expect(lines.join("\n")).not.toContain("SENTRY_DSN");
    } finally {
      restore();
    }
  });

  it("names nothing for a set value", () => {
    const restore = withValue("TAKEDOWN_SECRET", "set-here");
    try {
      const lines: string[] = [];

      checkDeploymentConfig(lines);

      expect(lines.join("\n")).not.toContain("TAKEDOWN_SECRET");
    } finally {
      restore();
    }
  });

  it("reports by level exactly the four the owner chose", () => {
    const named = deploymentConfig
      .filter((value) => isNamedByDigest(value))
      .map((value) => value.need);

    expect(new Set(named)).toStrictEqual(
      new Set(["yes", "strongly", "before friends", "before public"]),
    );
  });
});
