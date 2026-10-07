import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  gaveUp,
  imports,
  outbox,
  products,
  productSnapshots,
  runs,
  stravaConnections,
  userProfiles,
} from "../../src/db/schema-core";
import { gaveUpUpsert } from "../../src/db/gave-up";
import { env } from "../../src/env";
import type { GaveUpKind } from "../../src/lib/contracts/gave-up";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { oweOutbox, outboxInsert } from "../../src/modules/ops/outbox";
import {
  GAVE_UP_LIST_LIMIT,
  dropGaveUp,
  gaveUpJobs,
  retryGaveUp,
  type RetryDeps,
} from "../../src/modules/ops/gave-up";
import { todayCounts } from "../../src/modules/ops/desk";
import {
  createOrGetBrand,
  createOrGetProduct,
} from "../../src/modules/products";
import { reminderSubject } from "../../src/modules/runs/queue-messages";
import { gaveUpRow } from "../gave-up-rows";

/**
 * The Desk's Gave up (Operator Screens D6, a section of Today; R-119):
 * the rows as Today reads them, the counts the rail and the digest read,
 * and each job's Retry and Drop.
 */

function db() {
  return drizzle(env.DIALED_CORE);
}

async function gaveUpFor(
  kind: GaveUpKind,
  subjectId: string,
  at = nowSeconds(),
  overrides: { rawError?: string; tries?: number } = {},
): Promise<string> {
  await gaveUpUpsert(
    db(),
    { kind, subjectId, reason: `${kind} stopped.`, tries: 3, ...overrides },
    at,
  );
  const row = await gaveUpRow(kind, subjectId);
  return row?.id ?? "";
}

function depsWith(overrides: Partial<RetryDeps> = {}) {
  const enrichmentQueue = { send: vi.fn(() => Promise.resolve()) };
  const importsQueue = { send: vi.fn(() => Promise.resolve()) };
  const reextract = vi.fn(() => Promise.resolve<unknown>({ filled: [] }));
  return {
    deps: {
      db: db(),
      enrichmentQueue,
      importsQueue,
      reextract,
      ...overrides,
    },
    enrichmentQueue,
    importsQueue,
    reextract,
  };
}

async function product(extractionStatus: "failed" | "done" = "failed") {
  const brand = await createOrGetBrand(db(), `Janji ${newUlid()}`);
  const row = await createOrGetProduct(db(), {
    brandId: brand.id,
    name: "AFO Middle Layer",
    sourceUrl: "https://janji.example/afo",
    createdBy: newUlid(),
  });
  await db()
    .update(products)
    .set({ extractionStatus })
    .where(eq(products.id, row.id));
  return { id: row.id, brand: brand.name };
}

async function runner(username = "sam"): Promise<string> {
  const userId = newUlid();
  await db().insert(userProfiles).values({ userId, username });
  return userId;
}

/**
A runner who never claimed a handle.
*/
async function namelessRunner(): Promise<string> {
  const userId = newUlid();
  await db().insert(userProfiles).values({ userId });
  return userId;
}

async function failedRun(userId: string): Promise<string> {
  const id = newUlid();
  await db()
    .insert(runs)
    .values({
      id,
      userId,
      source: "manual",
      // Sun Sep 14 2025, 06:10 UTC.
      startedAt: Date.UTC(2025, 8, 14, 6, 10) / 1000,
      durationS: 1800,
      distanceM: 5000,
      lat: 60,
      lng: 20,
      title: "Run",
      weatherStatus: "failed",
    });
  return id;
}

async function failedImport(userId: string) {
  const id = newUlid();
  const r2Key = `imports/${userId}/${id}.tcx`;
  await db().insert(imports).values({
    id,
    userId,
    r2Key,
    status: "failed",
    failureReason: "We couldn't process this import after several tries.",
    createdAt: nowSeconds(),
  });
  return { id, r2Key };
}

const REMINDER = {
  type: "strava_reminder",
  athleteId: "9001",
  objectId: "77",
  aspectType: "create",
  eventTime: 1_700_000_000,
} as const;

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(async () => {
  await db().delete(gaveUp);
  await db().delete(userProfiles);
});

describe("gaveUpJobs", () => {
  it("is empty when nothing gave up", async () => {
    expect(await gaveUpJobs()).toStrictEqual([]);
  });

  it("says what each job was doing, newest failure first", async () => {
    const sam = await runner("sam");
    const shoe = await product();
    const runId = await failedRun(sam);
    const upload = await failedImport(sam);
    await db().insert(stravaConnections).values({
      userId: sam,
      athleteId: REMINDER.athleteId,
      refreshToken: "r",
    });
    const now = nowSeconds();
    await gaveUpFor("weather", runId, now - 40);
    await gaveUpFor("enrichment", shoe.id, now - 10);
    await gaveUpFor("import", upload.id, now - 20);
    await gaveUpFor("reminder", reminderSubject(REMINDER), now - 30);

    const jobs = await gaveUpJobs();

    expect(jobs.map((job) => [job.kind, job.doing])).toStrictEqual([
      [
        "enrichment",
        `Read the product page for ${shoe.brand} AFO Middle Layer`,
      ],
      ["import", "Read @sam's run file"],
      ["reminder", "Remind @sam about a new run on Strava"],
      ["weather", "Fetch weather for @sam's run, Sep 14 · 6:10 AM"],
    ]);
  });

  it("carries the row as stored: reason, raw error, tries and both times", async () => {
    const runId = await failedRun(await runner());
    await gaveUpFor("weather", runId, 1000, { rawError: "boom", tries: 5 });

    const [found] = await gaveUpJobs();

    expect(found).toMatchObject({
      kind: "weather",
      reason: "weather stopped.",
      rawError: "boom",
      tries: 5,
      firstFailedAt: 1000,
      lastFailedAt: 1000,
      hasStoredPage: false,
    });
  });

  it("knows which products have a stored page to re-run", async () => {
    const stored = await product();
    const bare = await product();
    await db().insert(productSnapshots).values({
      id: newUlid(),
      productId: stored.id,
      url: "https://janji.example/afo",
      r2Key: "snapshots/x",
      rung: "none",
      fetchedAt: Date.now(),
    });
    await gaveUpFor("enrichment", stored.id, 2);
    await gaveUpFor("enrichment", bare.id, 1);

    const jobs = await gaveUpJobs();

    expect(jobs.map((job) => job.hasStoredPage)).toStrictEqual([true, false]);
  });

  it("names a runner with no handle, and a subject that is gone", async () => {
    const nameless = await namelessRunner();
    const runId = await failedRun(nameless);
    await gaveUpFor("weather", runId, 6);
    await gaveUpFor("weather", newUlid(), 5);
    await gaveUpFor("enrichment", newUlid(), 4);
    await gaveUpFor("import", newUlid(), 3);
    await gaveUpFor("reminder", "not a job", 2);

    const jobs = await gaveUpJobs();

    expect(jobs.map((job) => job.doing)).toStrictEqual([
      "Fetch weather for a runner's run, Sep 14 · 6:10 AM",
      "Fetch weather for a run that is gone",
      "Read the page for a product that is gone",
      "Read a run file whose import is gone",
      "Remind a runner about a new run on Strava",
    ]);
  });

  it("names a product without a brand by its name alone", async () => {
    const productId = newUlid();
    await db().insert(products).values({
      id: productId,
      brandId: "no-such-brand",
      name: "Mystery Tee",
      normalizedName: "mystery tee",
      createdBy: newUlid(),
      createdAt: nowSeconds(),
    });
    await gaveUpFor("enrichment", productId);

    const [found] = await gaveUpJobs();

    expect(found?.doing).toBe("Read the product page for Mystery Tee");
  });

  it(`lists the newest ${String(GAVE_UP_LIST_LIMIT)} and no more`, async () => {
    for (let index = 0; index <= GAVE_UP_LIST_LIMIT; index += 1) {
      await gaveUpFor("weather", `run-${String(index)}`, index);
    }

    const jobs = await gaveUpJobs();

    expect(jobs).toHaveLength(GAVE_UP_LIST_LIMIT);
    expect(jobs[0]?.lastFailedAt).toBe(GAVE_UP_LIST_LIMIT);
  });
});

describe("todayCounts' Gave up", () => {
  it("is zero, with no oldest, when nothing gave up", async () => {
    const counts = await todayCounts();

    expect(counts.gaveUp).toBe(0);
    expect(counts.oldestGaveUpAt).toBeUndefined();
  });

  it("counts every row, and dates the longest-standing by its first failure", async () => {
    await gaveUpFor("weather", "a", 500);
    await gaveUpFor("weather", "b", 300);
    // Failed first at 300, again at 900: still the oldest.
    await gaveUpFor("weather", "b", 900);

    const counts = await todayCounts();

    expect(counts.gaveUp).toBe(2);
    expect(counts.oldestGaveUpAt).toBe(300);
  });
});

describe("retryGaveUp", () => {
  it("re-fetches an enrichment job: claims the product and sends it, and the row goes", async () => {
    const shoe = await product();
    const id = await gaveUpFor("enrichment", shoe.id);
    const { deps, enrichmentQueue, reextract } = depsWith();

    expect(await retryGaveUp({ id, step: "again" }, deps)).toBe("retried");

    expect(enrichmentQueue.send).toHaveBeenCalledWith({
      type: "enrich",
      productId: shoe.id,
    });
    expect(reextract).not.toHaveBeenCalled();
    const [row] = await db()
      .select({ status: products.extractionStatus })
      .from(products)
      .where(eq(products.id, shoe.id));
    expect(row?.status).toBe("pending");
    expect(await gaveUpRow("enrichment", shoe.id)).toBeUndefined();
  });

  it("re-runs extraction over the stored page, without a fetch", async () => {
    const shoe = await product();
    const id = await gaveUpFor("enrichment", shoe.id);
    const { deps, enrichmentQueue, reextract } = depsWith();

    expect(await retryGaveUp({ id, step: "extract" }, deps)).toBe("retried");

    expect(reextract).toHaveBeenCalledWith(shoe.id);
    expect(enrichmentQueue.send).not.toHaveBeenCalled();
    expect(await gaveUpRow("enrichment", shoe.id)).toBeUndefined();
  });

  it("keeps the row when there is no stored page to re-run", async () => {
    const shoe = await product();
    const id = await gaveUpFor("enrichment", shoe.id);
    const { deps } = depsWith({ reextract: () => Promise.resolve(undefined) });

    expect(await retryGaveUp({ id, step: "extract" }, deps)).toBe("no-page");

    expect(await gaveUpRow("enrichment", shoe.id)).toBeDefined();
  });

  it("puts a run's weather back to pending for the hourly cron", async () => {
    const runId = await failedRun(await runner());
    const id = await gaveUpFor("weather", runId);
    const { deps, importsQueue } = depsWith();

    expect(await retryGaveUp({ id, step: "again" }, deps)).toBe("retried");

    const [row] = await db()
      .select({ status: runs.weatherStatus })
      .from(runs)
      .where(eq(runs.id, runId));
    expect(row?.status).toBe("pending");
    expect(importsQueue.send).not.toHaveBeenCalled();
    expect(await gaveUpRow("weather", runId)).toBeUndefined();
  });

  it("leaves a run whose weather resolved meanwhile alone", async () => {
    const runId = await failedRun(await runner());
    await db()
      .update(runs)
      .set({ weatherStatus: "manual" })
      .where(eq(runs.id, runId));
    const id = await gaveUpFor("weather", runId);

    await retryGaveUp({ id, step: "again" }, depsWith().deps);

    const [row] = await db()
      .select({ status: runs.weatherStatus })
      .from(runs)
      .where(eq(runs.id, runId));
    expect(row?.status).toBe("manual");
  });

  it("re-sends an import, back to pending, with its file's deletion cancelled", async () => {
    const userId = await runner();
    const upload = await failedImport(userId);
    const other = await failedImport(userId);
    const owe = (key: string) =>
      outboxInsert(
        db(),
        oweOutbox(
          { kind: "import_file_expire", payload: { userId, key } },
          nowSeconds() + 1000,
        ),
      );
    await db().batch([owe(upload.r2Key), owe(other.r2Key)]);
    const id = await gaveUpFor("import", upload.id);
    const { deps, importsQueue } = depsWith();

    expect(await retryGaveUp({ id, step: "again" }, deps)).toBe("retried");

    expect(importsQueue.send).toHaveBeenCalledWith({
      type: "import",
      importId: upload.id,
    });
    const [row] = await db()
      .select()
      .from(imports)
      .where(eq(imports.id, upload.id));
    expect(row?.status).toBe("pending");
    expect(row?.failureReason).toBeNull();
    const owed = await db()
      .select({ key: outbox.dedupeKey })
      .from(outbox)
      .where(eq(outbox.kind, "import_file_expire"));
    expect(owed.map((debt) => debt.key)).toStrictEqual([
      `${userId}:${other.r2Key}`,
    ]);
    expect(await gaveUpRow("import", upload.id)).toBeUndefined();
  });

  it("leaves an import pending for the sweep when its send fails, and says so", async () => {
    const upload = await failedImport(await runner());
    const id = await gaveUpFor("import", upload.id);
    const error = vi.spyOn(console, "error").mockImplementation(() => {
      /*
      Sentry is disabled in tests; the report is what is asserted.
      */
    });
    const { deps } = depsWith({
      importsQueue: { send: () => Promise.reject(new Error("queue down")) },
    });

    expect(await retryGaveUp({ id, step: "again" }, deps)).toBe("retried");

    const [row] = await db()
      .select({ status: imports.status })
      .from(imports)
      .where(eq(imports.id, upload.id));
    expect(row?.status).toBe("pending");
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("sentry-disabled"),
      { surface: "desk-retry-import", importId: upload.id },
      expect.objectContaining({ message: "queue down" }),
    );
  });

  it("forgets an import that is gone", async () => {
    const importId = newUlid();
    const id = await gaveUpFor("import", importId);
    const { deps, importsQueue } = depsWith();

    expect(await retryGaveUp({ id, step: "again" }, deps)).toBe("gone");

    expect(importsQueue.send).not.toHaveBeenCalled();
    expect(await gaveUpRow("import", importId)).toBeUndefined();
  });

  it("sends a reminder again as the job it was, and the row goes", async () => {
    const subject = reminderSubject(REMINDER);
    const id = await gaveUpFor("reminder", subject);
    const { deps, importsQueue } = depsWith();

    expect(await retryGaveUp({ id, step: "again" }, deps)).toBe("retried");

    expect(importsQueue.send).toHaveBeenCalledWith(REMINDER);
    expect(await gaveUpRow("reminder", subject)).toBeUndefined();
  });

  it("keeps a reminder's row when its send fails, so it can be pressed again", async () => {
    const subject = reminderSubject(REMINDER);
    const id = await gaveUpFor("reminder", subject);
    const { deps } = depsWith({
      importsQueue: { send: () => Promise.reject(new Error("queue down")) },
    });

    await expect(retryGaveUp({ id, step: "again" }, deps)).rejects.toThrow(
      "queue down",
    );

    expect(await gaveUpRow("reminder", subject)).toBeDefined();
  });

  it("forgets a reminder row that holds no job", async () => {
    const id = await gaveUpFor("reminder", "garbage");
    const { deps, importsQueue } = depsWith();

    expect(await retryGaveUp({ id, step: "again" }, deps)).toBe("gone");

    expect(importsQueue.send).not.toHaveBeenCalled();
    expect(await gaveUpRow("reminder", "garbage")).toBeUndefined();
  });

  it("is safe to press twice: the second finds the row gone and sends nothing", async () => {
    const shoe = await product();
    const id = await gaveUpFor("enrichment", shoe.id);
    const { deps, enrichmentQueue } = depsWith();

    await retryGaveUp({ id, step: "again" }, deps);
    expect(await retryGaveUp({ id, step: "again" }, deps)).toBe("gone");

    expect(enrichmentQueue.send).toHaveBeenCalledTimes(1);
  });
});

describe("dropGaveUp", () => {
  it("removes the row and nothing else", async () => {
    const runId = await failedRun(await runner());
    const id = await gaveUpFor("weather", runId);
    const keep = await gaveUpFor("weather", "other");

    await dropGaveUp(id);

    expect(await gaveUpRow("weather", runId)).toBeUndefined();
    const [row] = await db()
      .select({ status: runs.weatherStatus })
      .from(runs)
      .where(eq(runs.id, runId));
    expect(row?.status).toBe("failed");
    const rest = await db().select({ id: gaveUp.id }).from(gaveUp);
    expect(rest).toStrictEqual([{ id: keep }]);
  });

  it("is a no-op the second time", async () => {
    const id = await gaveUpFor("weather", "twice");

    await dropGaveUp(id);
    await expect(dropGaveUp(id)).resolves.toBeUndefined();
  });
});

describe("retryGaveUp with the Worker's own deps", () => {
  it("reaches the core database and the queues the Worker binds", async () => {
    const runId = await failedRun(await runner("live"));
    const id = await gaveUpFor("weather", runId);

    expect(await retryGaveUp({ id, step: "again" })).toBe("retried");

    expect(await gaveUpRow("weather", runId)).toBeUndefined();
  });

  it("hands the stored page to enrichment's own extraction, model and all", async () => {
    // The test pool's model key is a placeholder, so the model refuses:
    // which proves the stored page reached enrichment's real deps, and
    // that a failed re-run keeps the row for another press.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 401 }),
    );
    const shoe = await product();
    const r2Key = `snapshots/${shoe.id}/live.html`;
    await env.MEDIA.put(r2Key, "<html><head><title>Tee</title></head></html>");
    await db().insert(productSnapshots).values({
      id: newUlid(),
      productId: shoe.id,
      url: "https://janji.example/afo",
      r2Key,
      rung: "none",
      fetchedAt: Date.now(),
    });
    const id = await gaveUpFor("enrichment", shoe.id);

    await expect(retryGaveUp({ id, step: "extract" })).rejects.toThrow(
      "Model returned 401",
    );

    expect(await gaveUpRow("enrichment", shoe.id)).toBeDefined();
  });
});

describe("a stored page is enrichment's alone", () => {
  it("says no stored page for another job whose subject a product shares", async () => {
    const shoe = await product();
    await db().insert(productSnapshots).values({
      id: newUlid(),
      productId: shoe.id,
      url: "https://janji.example/afo",
      r2Key: "snapshots/y",
      rung: "none",
      fetchedAt: Date.now(),
    });
    await gaveUpFor("weather", shoe.id);

    const [found] = await gaveUpJobs();

    expect(found?.hasStoredPage).toBe(false);
  });
});
