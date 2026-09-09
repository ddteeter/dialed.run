import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cronCheckpoints,
  imports,
  runs,
  stravaRevocations,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid, type Ulid } from "../../src/lib/ids";
import { handleScheduled } from "../../src/modules/ops";

/**
 * The daily digest is a cron whose entire product is a list of things a
 * human should look at, and none of that list was asserted. Sixty-one
 * mutants survived here: every threshold could be inverted, every window
 * could point into the future instead of the past, and every anomaly
 * sentence could be emptied, because the only observable was a
 * `captureException` nothing watched.
 *
 * `handleScheduled` now returns what it found, so these read the answer
 * instead of inferring it.
 */

const HOUR = 3600;
const DIGEST = { cron: "0 12 * * *" } as ScheduledController;

function coreDb() {
  return drizzle(env.DIALED_CORE);
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

async function insertImport(
  overrides: Partial<typeof imports.$inferInsert>,
): Promise<Ulid> {
  const id = newUlid();
  await coreDb()
    .insert(imports)
    .values({
      id,
      userId: newUlid(),
      r2Key: `imports/${id}.fit`,
      status: "pending",
      createdAt: nowSeconds(),
      ...overrides,
    });
  return id;
}

async function insertRun(
  overrides: Partial<typeof runs.$inferInsert>,
): Promise<Ulid> {
  const id = newUlid();
  await coreDb()
    .insert(runs)
    .values({
      id,
      userId: newUlid(),
      source: "manual",
      startedAt: nowSeconds(),
      durationS: 1800,
      distanceM: 5000,
      indoor: false,
      title: "Digest test run",
      ...overrides,
    });
  return id;
}

/**
 * The digest reads three tables and reports on anything it finds, so a row
 * another test left behind is an anomaly this one did not cause.
 */
async function emptyTheTablesTheDigestReads(): Promise<void> {
  const db = coreDb();
  await db.delete(imports);
  await db.delete(stravaRevocations);
  await db.delete(runs);
}

beforeEach(async () => {
  await emptyTheTablesTheDigestReads();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the cron heartbeat", () => {
  it("stamps last_run_at in epoch seconds, not milliseconds", async () => {
    // A millisecond value here reads as the year 57000, and the digest's
    // own "stale cron" check would never fire again.
    const before = nowSeconds();

    await handleScheduled(DIGEST);

    const [row] = await coreDb()
      .select()
      .from(cronCheckpoints)
      .where(eq(cronCheckpoints.cronName, "daily-digest"));
    expect(row?.lastRunAt).toBeGreaterThanOrEqual(before - 5);
    expect(row?.lastRunAt).toBeLessThanOrEqual(nowSeconds() + 5);
  });

  it("restamps the same row on a second run rather than adding another", async () => {
    // Law 1: crons re-fire. The conflict arm is a second copy of the same
    // timestamp expression, and only the insert half was ever executed —
    // so a millisecond value could live there indefinitely.
    await handleScheduled(DIGEST);
    const before = nowSeconds();
    await handleScheduled(DIGEST);

    const rows = await coreDb()
      .select()
      .from(cronCheckpoints)
      .where(eq(cronCheckpoints.cronName, "daily-digest"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.lastRunAt).toBeGreaterThanOrEqual(before - 5);
    expect(rows[0]?.lastRunAt).toBeLessThanOrEqual(nowSeconds() + 5);
  });

  it("runs the weather retry on its own schedule and finds nothing to say", async () => {
    // The hourly cron reports through `runs.weather_status`, not through
    // the digest, so its outcome carries no anomalies — which is a claim
    // worth pinning, because "anomalies" is the field a pager reads.
    const outcome = await handleScheduled({
      cron: "0 * * * *",
    } as ScheduledController);

    expect(outcome).toStrictEqual({ cronName: "weather-retry", anomalies: [] });
  });

  it("files a cron it does not recognise under `unknown`, and says so", async () => {
    // Config/code skew: wrangler fired a schedule the registry has never
    // heard of. The row still gets written — losing the heartbeat as well
    // would hide the skew twice.
    const error = vi.spyOn(console, "error").mockImplementation(nothing);

    const outcome = await handleScheduled({
      cron: "*/7 * * * *",
    } as ScheduledController);

    expect(outcome).toStrictEqual({ cronName: "unknown", anomalies: [] });
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("sentry-disabled"),
      { cron: "*/7 * * * *" },
      expect.objectContaining({ message: "unrecognized cron fired" }),
    );
    const [row] = await coreDb()
      .select()
      .from(cronCheckpoints)
      .where(eq(cronCheckpoints.cronName, "unknown"));
    expect(row).toBeDefined();
  });
});

function nothing(): void {
  /*
   * The point is to do nothing.
   */
}

describe("the digest reports nothing when there is nothing", () => {
  it("finds no anomalies against empty tables, and raises nothing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(nothing);

    const outcome = await handleScheduled(DIGEST);

    expect(outcome).toStrictEqual({ cronName: "daily-digest", anomalies: [] });
    // The threshold, not just the list: reporting an empty digest every
    // day is how an alert channel gets muted.
    expect(error).not.toHaveBeenCalled();
  });
});

describe("stalled imports are re-dispatched, and reported", () => {
  it("re-enqueues an import that has sat pending past the grace window", async () => {
    const send = vi.spyOn(env.IMPORTS_QUEUE, "send");
    vi.spyOn(console, "error").mockImplementation(nothing);
    const importId = await insertImport({
      createdAt: nowSeconds() - 20 * 60,
    });

    const outcome = await handleScheduled(DIGEST);

    expect(send).toHaveBeenCalledWith({ type: "import", importId });
    expect(outcome.anomalies).toContain(
      "1 import(s) stalled pending and were re-dispatched",
    );
  });

  it("leaves an import inside the grace window alone", async () => {
    // The window points backwards. Flipped, this re-dispatches everything
    // that has *not* had time to run yet and races the real dispatch.
    const send = vi.spyOn(env.IMPORTS_QUEUE, "send");
    await insertImport({ createdAt: nowSeconds() - 5 * 60 });

    const outcome = await handleScheduled(DIGEST);

    expect(send).not.toHaveBeenCalled();
    expect(outcome.anomalies).toStrictEqual([]);
  });

  it("gives up on an import at fifteen minutes, not before", async () => {
    const send = vi.spyOn(env.IMPORTS_QUEUE, "send");
    await insertImport({ createdAt: nowSeconds() - 15 * 60 - 2 });

    await handleScheduled(DIGEST);

    expect(send).toHaveBeenCalledTimes(1);
  });

  it("only re-dispatches imports that are still pending", async () => {
    // `processing` is claimed by a consumer; `done`, `failed` and
    // `duplicate` are terminal. Re-enqueueing any of them is work the
    // system already did.
    const send = vi.spyOn(env.IMPORTS_QUEUE, "send");
    const old = nowSeconds() - HOUR;
    for (const status of ["processing", "done", "failed", "duplicate"] as const) {
      await insertImport({ status, createdAt: old });
    }

    const outcome = await handleScheduled(DIGEST);

    expect(send).not.toHaveBeenCalled();
    expect(outcome.anomalies).toStrictEqual([]);
  });

  it("still reports the backlog when the queue send itself fails", async () => {
    // Law 6: the re-dispatch is the recovery, and a recovery that fails
    // silently is worse than one that never ran.
    const error = vi.spyOn(console, "error").mockImplementation(nothing);
    vi.spyOn(env.IMPORTS_QUEUE, "send").mockRejectedValue(
      new Error("queue unavailable"),
    );
    await insertImport({ createdAt: nowSeconds() - HOUR });

    const outcome = await handleScheduled(DIGEST);

    expect(outcome.anomalies).toContain(
      "1 import(s) stalled pending and were re-dispatched",
    );
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("sentry-disabled"),
      expect.objectContaining({ surface: "import-redispatch" }),
      expect.anything(),
    );
  });
});

async function insertRevocation(): Promise<Ulid> {
  const id = newUlid();
  await coreDb().insert(stravaRevocations).values({
    id,
    accessToken: "token",
    createdAt: nowSeconds(),
  });
  return id;
}

describe("stranded Strava revocations are re-dispatched, and reported", () => {
  it("re-enqueues every row the outbox still holds", async () => {
    const send = vi.spyOn(env.IMPORTS_QUEUE, "send");
    vi.spyOn(console, "error").mockImplementation(nothing);
    const revocationId = await insertRevocation();

    const outcome = await handleScheduled(DIGEST);

    expect(send).toHaveBeenCalledWith({
      type: "strava_revoke",
      revocationId,
    });
    expect(outcome.anomalies).toContain(
      "1 Strava revocation(s) awaited re-dispatch",
    );
  });

  it("still reports the backlog when the queue send itself fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(nothing);
    vi.spyOn(env.IMPORTS_QUEUE, "send").mockRejectedValue(
      new Error("queue unavailable"),
    );
    await insertRevocation();

    const outcome = await handleScheduled(DIGEST);

    expect(outcome.anomalies).toContain(
      "1 Strava revocation(s) awaited re-dispatch",
    );
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("sentry-disabled"),
      expect.objectContaining({ surface: "revocation-redispatch" }),
      expect.anything(),
    );
  });
});

describe("the weather backlog check", () => {
  it("reports a run whose weather gave up", async () => {
    vi.spyOn(console, "error").mockImplementation(nothing);
    await insertRun({ weatherStatus: "failed" });

    const outcome = await handleScheduled(DIGEST);

    expect(outcome.anomalies).toContain(
      "weather backlog: 1 run(s) failed/stuck pending",
    );
  });

  it("reports a run still pending after a day", async () => {
    vi.spyOn(console, "error").mockImplementation(nothing);
    await insertRun({
      weatherStatus: "pending",
      startedAt: nowSeconds() - 25 * HOUR,
    });

    const outcome = await handleScheduled(DIGEST);

    expect(outcome.anomalies).toContain(
      "weather backlog: 1 run(s) failed/stuck pending",
    );
  });

  it("leaves a run pending inside the retry cron's own window alone", async () => {
    // The hourly retry still owns anything younger than a day. Flagging it
    // here would report every run logged this morning.
    await insertRun({
      weatherStatus: "pending",
      startedAt: nowSeconds() - 2 * HOUR,
    });

    const outcome = await handleScheduled(DIGEST);

    expect(outcome.anomalies).toStrictEqual([]);
  });

  it("ignores runs whose weather is settled", async () => {
    for (const weatherStatus of ["attached", "manual", "none"] as const) {
      await insertRun({ weatherStatus, startedAt: nowSeconds() - 30 * HOUR });
    }

    const outcome = await handleScheduled(DIGEST);

    expect(outcome.anomalies).toStrictEqual([]);
  });
});

describe("everything the digest found, in one report", () => {
  it("raises a single Sentry event carrying every anomaly", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(nothing);
    await insertRun({ weatherStatus: "failed" });
    await insertImport({ createdAt: nowSeconds() - HOUR });

    const outcome = await handleScheduled(DIGEST);

    expect(outcome.anomalies).toHaveLength(2);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("sentry-disabled"),
      { anomalies: outcome.anomalies.join("; ") },
      expect.objectContaining({ message: "daily digest anomalies" }),
    );
  });
});
