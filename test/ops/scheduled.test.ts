import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cronCheckpoints,
  entryPhotos,
  imports,
  outfitEntries,
  products,
  reports,
  reviewQueue,
  runs,
  stravaRevocations,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid, type Ulid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { handleScheduled } from "../../src/modules/ops";
import {
  createOrGetBrand,
  createOrGetProduct,
} from "../../src/modules/products";

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
const ENRICHMENT_RETRY = { cron: "30 * * * *" } as ScheduledController;

function coreDb() {
  return drizzle(env.DIALED_CORE);
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
  // The moderation tables belong on this list too: the digest counts the
  // review queue's depth, so a row left behind by one test appears as
  // "2 item(s) awaiting moderation review" in the next one's anomalies —
  // which fails every assertion in the file that expects a quiet digest,
  // and points at the digest rather than at the leak.
  await db.delete(reviewQueue);
  await db.delete(reports);
  await db.delete(entryPhotos);
  await db.delete(outfitEntries);
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

  it("dispatches the screening-retry schedule to the screening sweep", async () => {
    // The case label is the whole wiring: `wrangler.jsonc` fires a cron
    // expression, `crons.ts` maps it to a name, and this switch turns the
    // name into work. A wrong label here means the sweep silently never
    // runs and every flagged photo stays pending forever — which looks
    // exactly like a classifier that is simply slow.
    // A photo waiting to be screened, so the sweep has something to say.
    const userId = newUlid();
    const runId = await insertRun({ userId });
    const entryId = newUlid();
    await coreDb().insert(outfitEntries).values({
      id: entryId,
      userId,
      runId,
      verdict: 0,
      isPublic: true,
      createdAt: nowSeconds(),
    });
    await coreDb()
      .insert(entryPhotos)
      .values({
        id: newUlid(),
        entryId,
        photoKey: `entries/${userId}/${entryId}/p`,
        position: 0,
      });

    const outcome = await handleScheduled({
      cron: "15 * * * *",
    } as ScheduledController);

    // **The name is not the assertion.** `cronName` comes from the
    // registry lookup, not from the case label, so it reads
    // "screening-retry" whether or not this switch does anything — which
    // is what the sweep silently never running would look like. The
    // anomaly is the proof that work happened.
    expect(outcome.cronName).toBe("screening-retry");
    // Matched loosely on purpose. Which sentence comes back depends on
    // whether a classifier key is configured — "photos await screening;
    // OPENAI_API_KEY is not set" without one, "still pending after a
    // screening sweep" with one that cannot answer — and both prove the
    // same thing here: the sweep ran. The exact wording is pinned in
    // `test/safety/retry.test.ts`, which owns it.
    expect(outcome.anomalies).toEqual([expect.stringContaining("screening")]);
  });

  it("says so when the sweep finds reports that were never acted on", async () => {
    // The gap this covers is a crash between `fileReport`'s insert and its
    // hide. Reproduced by writing the reports directly, which is what that
    // half-finished state looks like on disk.
    const author = newUlid();
    const runId = await insertRun({ userId: author });
    const entryId = newUlid();
    await coreDb().insert(outfitEntries).values({
      id: entryId,
      userId: author,
      runId,
      verdict: 0,
      isPublic: true,
      createdAt: nowSeconds(),
    });
    for (let n = 0; n < 3; n += 1) {
      await coreDb().insert(reports).values({
        id: newUlid(),
        reporterId: newUlid(),
        subjectType: "entry",
        subjectId: entryId,
        reason: "explicit",
        createdAt: nowSeconds(),
      });
    }

    const outcome = await handleScheduled({
      cron: "15 * * * *",
    } as ScheduledController);

    // The digest is the only place a solo operator would ever learn this
    // happened, so the line has to be there and has to say what it was.
    expect(outcome.anomalies).toContainEqual(
      expect.stringContaining("had not been hidden"),
    );
    const [row] = await coreDb()
      .select({ status: outfitEntries.moderationStatus })
      .from(outfitEntries)
      .where(eq(outfitEntries.id, entryId));
    expect(row?.status).toBe("hidden_pending_review");
  });

  it("says so when it takes a stale review claim back", async () => {
    // A claim stamped long enough ago that its lease has run out. Written
    // directly because the only other way to reach this state is to wait
    // half an hour.
    const queueId = newUlid();
    await coreDb()
      .insert(reviewQueue)
      .values({
        id: queueId,
        subjectType: "entry",
        subjectId: newUlid(),
        source: "reports",
        status: "reviewing",
        resolvedBy: newUlid(),
        claimedAt: nowSeconds() - 3600,
        createdAt: nowSeconds() - 3600,
      });

    const outcome = await handleScheduled({
      cron: "15 * * * *",
    } as ScheduledController);

    expect(outcome.anomalies).toContainEqual(
      expect.stringContaining("went stale"),
    );
    const [row] = await coreDb()
      .select({ status: reviewQueue.status })
      .from(reviewQueue)
      .where(eq(reviewQueue.id, queueId));
    expect(row?.status).toBe("pending");
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
    for (const status of [
      "processing",
      "done",
      "failed",
      "duplicate",
    ] as const) {
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

/**
A product in the given extraction state, created `ageSeconds` ago.
*/
async function insertProduct(
  status: typeof products.$inferInsert.extractionStatus,
  ageSeconds: number,
): Promise<string> {
  const db = coreDb();
  const brand = await createOrGetBrand(db, `Sweep ${newUlid()}`);
  const product = await createOrGetProduct(db, {
    brandId: brand.id,
    name: `Tee ${newUlid()}`,
    sourceUrl: "https://shop.example.com/p",
    createdBy: newUlid(),
  });
  await db
    .update(products)
    .set({ extractionStatus: status, createdAt: nowSeconds() - ageSeconds })
    .where(eq(products.id, product.id));
  return product.id;
}

describe("stalled enrichments are re-dispatched on their own hourly sweep", () => {
  beforeEach(async () => {
    await coreDb().delete(products);
  });

  it("claims a day of failures longer than D1 binds in one statement", async () => {
    // A day's failures are unbounded, and D1 refuses more than 100 bound
    // parameters in one statement — which failed the whole claim, and the
    // re-dispatch with it, on exactly the day an outage made the most.
    for (let index = 0; index < 150; index += 1) {
      await insertProduct("failed", HOUR);
    }

    await handleScheduled(ENRICHMENT_RETRY);

    const statuses = await coreDb()
      .select({ status: products.extractionStatus })
      .from(products);
    expect(statuses).toHaveLength(150);
    expect(statuses.every((row) => row.status === "pending")).toBe(true);
  });

  it("re-enqueues a product that has sat pending past the grace window", async () => {
    const send = vi.spyOn(env.ENRICHMENT_QUEUE, "send");
    const productId = await insertProduct("pending", 20 * 60);

    const outcome = await handleScheduled(ENRICHMENT_RETRY);

    expect(outcome.cronName).toBe("enrichment-retry");
    expect(send).toHaveBeenCalledWith({ type: "enrich", productId });
    expect(outcome.anomalies).toStrictEqual([
      "1 product(s) unfinished by enrichment and were re-dispatched",
    ]);
  });

  it("leaves a product inside the grace window alone", async () => {
    const send = vi.spyOn(env.ENRICHMENT_QUEUE, "send");
    await insertProduct("pending", 5 * 60);

    const outcome = await handleScheduled(ENRICHMENT_RETRY);

    expect(send).not.toHaveBeenCalled();
    expect(outcome.anomalies).toStrictEqual([]);
  });

  it("gives up on a product at fifteen minutes, not before", async () => {
    const send = vi.spyOn(env.ENRICHMENT_QUEUE, "send");
    await insertProduct("pending", 15 * 60 + 2);

    await handleScheduled(ENRICHMENT_RETRY);

    expect(send).toHaveBeenCalledTimes(1);
  });

  it("re-drives a failed product too, so an outage heals itself", async () => {
    // **Composition comes only from the model now**, so a job that
    // exhausted its retries while OpenAI was unreachable dead-lettered
    // and marked the product `failed` — and `requestEnrichment` only claims
    // `failed` on a *new paste*, so nothing would look at it again. The row
    // cannot tell "this page states no composition" from "the model was
    // down", and the costs are asymmetric: re-fetching a page that has
    // nothing is cheap, abandoning a product is forever.
    const send = vi.spyOn(env.ENRICHMENT_QUEUE, "send");
    const productId = await insertProduct("failed", HOUR);

    const outcome = await handleScheduled(ENRICHMENT_RETRY);

    expect(send).toHaveBeenCalledWith({ type: "enrich", productId });
    expect(outcome.anomalies).toStrictEqual([
      "1 product(s) unfinished by enrichment and were re-dispatched",
    ]);
    // And claimed: the consumer treats only `pending` as work, so a
    // re-dispatch that left the row `failed` was a message it acked and
    // ignored. The flip is what makes the re-drive real (PR #72 review).
    const [row] = await coreDb()
      .select({ status: products.extractionStatus })
      .from(products)
      .where(eq(products.id, productId));
    expect(row?.status).toBe("pending");
  });

  it("claims the row even when the send then fails, so the next sweep owns it", async () => {
    vi.spyOn(env.ENRICHMENT_QUEUE, "send").mockRejectedValue(
      new Error("queue down"),
    );
    vi.spyOn(console, "error").mockImplementation(nothing);
    const productId = await insertProduct("failed", HOUR);

    await handleScheduled(ENRICHMENT_RETRY);

    const [row] = await coreDb()
      .select({ status: products.extractionStatus })
      .from(products)
      .where(eq(products.id, productId));
    expect(row?.status).toBe("pending");
  });

  it("leaves a failed product inside the grace window alone, like a pending one", async () => {
    // The consumer may still be on it: a job that failed a minute ago is
    // being retried by the queue, and a sweep that flipped it back to
    // pending would race that retry.
    const send = vi.spyOn(env.ENRICHMENT_QUEUE, "send");
    await insertProduct("failed", 5 * 60);

    const outcome = await handleScheduled(ENRICHMENT_RETRY);

    expect(send).not.toHaveBeenCalled();
    expect(outcome.anomalies).toStrictEqual([]);
  });

  it("gives up on a failed product at fifteen minutes, not before", async () => {
    const send = vi.spyOn(env.ENRICHMENT_QUEUE, "send");
    await insertProduct("failed", 15 * 60 + 2);

    await handleScheduled(ENRICHMENT_RETRY);

    expect(send).toHaveBeenCalledTimes(1);
  });

  it("stops re-driving a failed product after its first day", async () => {
    // Unbounded, a page that 404s — or 403s even through the proxy, at a
    // credit a try — is re-fetched every hour for the life of the row.
    // Past a day it is abandoned, which the digest reports instead.
    const send = vi.spyOn(env.ENRICHMENT_QUEUE, "send");
    const productId = await insertProduct("failed", 25 * HOUR);

    const outcome = await handleScheduled(ENRICHMENT_RETRY);

    expect(send).not.toHaveBeenCalled();
    expect(outcome.anomalies).toStrictEqual([]);
    const [row] = await coreDb()
      .select({ status: products.extractionStatus })
      .from(products)
      .where(eq(products.id, productId));
    expect(row?.status).toBe("failed");
  });

  it("re-drives a failed product right up to the day, not one second past it", async () => {
    const send = vi.spyOn(env.ENRICHMENT_QUEUE, "send");
    await insertProduct("failed", 24 * HOUR - 2);

    await handleScheduled(ENRICHMENT_RETRY);

    expect(send).toHaveBeenCalledTimes(1);
  });

  it("keeps re-driving a pending product past the day, because pending is a claim", async () => {
    // `pending` means the row owes an extraction and nothing has said
    // otherwise; only `failed` has a verdict to stop on.
    const send = vi.spyOn(env.ENRICHMENT_QUEUE, "send");
    await insertProduct("pending", 3 * 24 * HOUR);

    await handleScheduled(ENRICHMENT_RETRY);

    expect(send).toHaveBeenCalledTimes(1);
  });

  it("leaves alone the states that are not enrichment's to finish", async () => {
    // `none` was never asked for, and `done` succeeded. Re-driving either
    // would be work the system already did, or never owed.
    const send = vi.spyOn(env.ENRICHMENT_QUEUE, "send");
    for (const status of ["none", "done"] as const) {
      await insertProduct(status, HOUR);
    }

    const outcome = await handleScheduled(ENRICHMENT_RETRY);

    expect(send).not.toHaveBeenCalled();
    expect(outcome.anomalies).toStrictEqual([]);
  });

  it("still reports the backlog when the queue send itself fails", async () => {
    vi.spyOn(env.ENRICHMENT_QUEUE, "send").mockRejectedValue(
      new Error("queue down"),
    );
    const error = vi.spyOn(console, "error").mockImplementation(nothing);
    await insertProduct("pending", HOUR);

    const outcome = await handleScheduled(ENRICHMENT_RETRY);

    expect(outcome.anomalies).toStrictEqual([
      "1 product(s) unfinished by enrichment and were re-dispatched",
    ]);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("sentry-disabled"),
      expect.objectContaining({ surface: "enrichment-redispatch" }),
      expect.objectContaining({ message: "queue down" }),
    );
  });
});

async function enriched(composition: string | undefined): Promise<void> {
  const id = await insertProduct("done", HOUR);
  if (composition === undefined) return;
  await coreDb()
    .update(products)
    .set({ fabricComposition: composition })
    .where(eq(products.id, id));
}

describe("the abandoned-enrichment check", () => {
  beforeEach(async () => {
    await coreDb().delete(products);
  });

  it("reports a failed product the sweep has stopped re-driving", async () => {
    // Law 6: a terminal failure lands somewhere a human sees. Until there
    // is an admin surface for dead-lettered work, this line is it.
    vi.spyOn(console, "error").mockImplementation(nothing);
    await insertProduct("failed", 25 * HOUR);

    const outcome = await handleScheduled(DIGEST);

    expect(outcome.anomalies).toStrictEqual([
      "1 product(s) abandoned by enrichment: failed, and past the sweep's day of retries",
    ]);
  });

  it("says nothing about a failed product the sweep still owns", async () => {
    await insertProduct("failed", 2 * HOUR);

    const outcome = await handleScheduled(DIGEST);

    expect(outcome.anomalies).toStrictEqual([]);
  });

  it("says nothing about an old product that finished", async () => {
    const id = await insertProduct("done", 3 * 24 * HOUR);
    // With a composition, so the yield check has nothing to say either.
    await coreDb()
      .update(products)
      .set({ fabricComposition: "100% merino wool" })
      .where(eq(products.id, id));

    const outcome = await handleScheduled(DIGEST);

    expect(outcome.anomalies).toStrictEqual([]);
  });
});

describe("the extraction-yield check", () => {
  beforeEach(async () => {
    await coreDb().delete(products);
  });

  it("says nothing while most enriched products have a composition", async () => {
    // The digest surfaces anomalies and nothing else. A line that appears
    // every day is a metric, and a metric in an alert channel is how an
    // alert channel gets ignored.
    await enriched("100% merino wool");
    await enriched("88% polyester, 12% elastane");
    await enriched(undefined);

    const outcome = await handleScheduled(DIGEST);

    expect(outcome.anomalies).toStrictEqual([]);
  });

  it("speaks up when most of them do not", async () => {
    // Some pages state no composition — one in twenty-two on the eval
    // corpus. *Most* of them meaning it is the shape of a budget that
    // stopped reaching the spec, or a model that got worse.
    await enriched("100% merino wool");
    await enriched(undefined);
    await enriched(undefined);
    vi.spyOn(console, "error").mockImplementation(nothing);

    const outcome = await handleScheduled(DIGEST);

    expect(outcome.anomalies).toStrictEqual([
      "2 of 3 enriched product(s) have no composition (67%)",
    ]);
  });

  it("speaks at exactly the threshold, not one past it", async () => {
    // Half is the bound, and half is loud enough to say so: `<` and `<=`
    // differ on exactly this input and on no other.
    await enriched("100% merino wool");
    await enriched("88% polyester");
    await enriched(undefined);
    await enriched(undefined);
    vi.spyOn(console, "error").mockImplementation(nothing);

    const outcome = await handleScheduled(DIGEST);

    expect(outcome.anomalies).toStrictEqual([
      "2 of 4 enriched product(s) have no composition (50%)",
    ]);
  });

  it("says nothing at all before anything has been enriched", async () => {
    // Nought of nought is not a hundred per cent.
    await insertProduct("pending", HOUR);
    const outcome = await handleScheduled(DIGEST);
    expect(outcome.anomalies).toStrictEqual([]);
  });
});

describe("the digest reports what is waiting on a person (106 §2)", () => {
  beforeEach(async () => {
    await coreDb().delete(reviewQueue);
  });

  it("says nothing on a day with an empty queue", async () => {
    const result = await handleScheduled(DIGEST);

    // A digest that speaks every day is one nobody reads. Zero waiting is
    // the ordinary case and gets no line.
    expect(result.anomalies).not.toContainEqual(
      expect.stringContaining("awaiting moderation"),
    );
  });

  it("reports a single waiting item, not just a backlog", async () => {
    await queueItem();

    const result = await handleScheduled(DIGEST);

    // Deliberately unlike the other digest checks, which fire past a
    // threshold. This queue's promise is "a person reads it within a day",
    // so the failure is a queue nobody opened rather than one that grew —
    // and a threshold would hide exactly that.
    expect(result.anomalies).toContainEqual(
      expect.stringContaining("1 item(s) awaiting moderation review"),
    );
  });

  it("counts the queue, not the reports behind it", async () => {
    await queueItem();
    await queueItem();

    const result = await handleScheduled(DIGEST);

    expect(result.anomalies).toContainEqual(
      expect.stringContaining("2 item(s)"),
    );
  });

  it("ignores decisions already made", async () => {
    await queueItem("approved");
    await queueItem("removed");

    const result = await handleScheduled(DIGEST);

    // Resolved rows stay in the table for the record; counting them would
    // make the digest louder every day forever.
    expect(result.anomalies).not.toContainEqual(
      expect.stringContaining("awaiting moderation"),
    );
  });
});

/**
One row in front of a reviewer, in the given state.
*/
async function queueItem(
  status: "pending" | "approved" | "removed" = "pending",
): Promise<void> {
  await coreDb().insert(reviewQueue).values({
    id: newUlid(),
    subjectType: "entry",
    subjectId: newUlid(),
    source: "reports",
    status,
    createdAt: nowSeconds(),
  });
}
