import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { imports, outfitEntries, runs } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { coreDb } from "../../src/modules/runs/core-db";
import {
  ImportUploadError,
  MAX_IMPORT_BYTES,
  getImportOutcome,
  startImport,
} from "../../src/modules/runs/imports";
import { newUlid } from "../../src/lib/ids";
import { selectOwnedRow } from "../../src/lib/sql/owned";
import type { ImportJob } from "../../src/modules/runs/queue-messages";
import { nowSeconds } from "../../src/lib/now";

/**
The stored row, read the way the module reads it — owner-scoped.
*/
async function importRow(userId: string, importId: string) {
  return selectOwnedRow(coreDb(), imports, { id: importId, userId });
}

/**
For the calls with nothing to report: only the delete-fails path reports.
*/
function noReport(): void {
  // Nothing is expected here; the tests that expect a report pass their own.
}

function fakeQueue() {
  const sent: ImportJob[] = [];
  return {
    sent,
    send: (message: ImportJob) => {
      sent.push(message);
      return Promise.resolve();
    },
  };
}

describe("startImport (102 §2)", () => {
  it("rejects an unsupported extension", async () => {
    const db = coreDb();
    const queue = fakeQueue();
    await expect(
      startImport(
        db,
        env.IMPORTS,
        queue,
        {
          userId: newUlid(),
          filename: "run.pdf",
          bytes: new ArrayBuffer(10),
        },
        noReport,
      ),
    ).rejects.toBeInstanceOf(ImportUploadError);
  });

  it("rejects an empty file", async () => {
    const db = coreDb();
    const queue = fakeQueue();
    await expect(
      startImport(
        db,
        env.IMPORTS,
        queue,
        {
          userId: newUlid(),
          filename: "run.gpx",
          bytes: new ArrayBuffer(0),
        },
        noReport,
      ),
    ).rejects.toBeInstanceOf(ImportUploadError);
  });

  it("rejects a file over the 25 MB cap", async () => {
    const db = coreDb();
    const queue = fakeQueue();
    await expect(
      startImport(
        db,
        env.IMPORTS,
        queue,
        {
          userId: newUlid(),
          filename: "run.fit",
          bytes: new ArrayBuffer(MAX_IMPORT_BYTES + 1),
        },
        noReport,
      ),
    ).rejects.toBeInstanceOf(ImportUploadError);
  });

  it("stores the file to R2, records a pending import, and enqueues the job", async () => {
    const db = coreDb();
    const queue = fakeQueue();
    const userId = newUlid();
    const bytes = new TextEncoder().encode("<gpx></gpx>").buffer;

    const { importId } = await startImport(
      db,
      env.IMPORTS,
      queue,
      {
        userId,
        filename: "run.gpx",
        bytes,
      },
      noReport,
    );

    expect(queue.sent).toEqual([{ type: "import", importId }]);

    const status = await importRow(userId, importId);
    expect(status?.status).toBe("pending");
    expect(status?.r2Key).toBe(`imports/${userId}/${importId}.gpx`);

    const object = await env.IMPORTS.get(status?.r2Key ?? "");
    expect(object).not.toBeNull();
  });

  it("reads an import's outcome back only for the user who started it", async () => {
    const db = coreDb();
    const queue = fakeQueue();
    const userId = newUlid();
    const otherUserId = newUlid();
    const { importId } = await startImport(
      db,
      env.IMPORTS,
      queue,
      {
        userId,
        filename: "run.tcx",
        bytes: new TextEncoder().encode("<tcx></tcx>").buffer,
      },
      noReport,
    );

    expect(await getImportOutcome(db, otherUserId, importId)).toBeUndefined();
    const outcome = await getImportOutcome(db, userId, importId);
    expect(outcome?.status).toBe("pending");
    expect(outcome?.failureReason).toBeNull();
    expect(outcome).toHaveProperty("run", undefined);
  });
});

/**
 * An import row pointing at a run, as the consumer leaves it once it
 * has parsed a file or found it already logged.
 */
async function landed(
  status: "done" | "duplicate",
  options: { withEntry?: boolean } = {},
) {
  const db = coreDb();
  const userId = newUlid();
  const runId = newUlid();
  const importId = newUlid();
  await db.insert(runs).values({
    id: runId,
    userId,
    source: "file",
    startedAt: 1_756_000_000,
    durationS: 3098,
    distanceM: 9978,
    title: "Morning run",
    weatherStatus: "pending",
    lat: 44.98,
    lng: -93.27,
  });
  await db.insert(imports).values({
    id: importId,
    userId,
    r2Key: `imports/${userId}/${importId}.gpx`,
    status,
    runId,
    createdAt: nowSeconds(),
  });
  if (options.withEntry === true) {
    await db.insert(outfitEntries).values({
      id: newUlid(),
      userId,
      runId,
      audience: "runners",
      createdAt: nowSeconds(),
    });
  }
  return { db, userId, runId, importId };
}

describe("getImportOutcome: what A1 draws in place", () => {
  it("carries the run a parse made, as the list and run detail see it", async () => {
    const { db, userId, runId, importId } = await landed("done");

    const outcome = await getImportOutcome(db, userId, importId);

    expect(outcome?.status).toBe("done");
    expect(outcome?.run).toMatchObject({
      id: runId,
      source: "file",
      distanceM: 9978,
      durationS: 3098,
      weatherStatus: "pending",
      entryId: undefined,
      hasVerdict: false,
      conditions: undefined,
    });
  });

  it("carries the run already logged, with its entry, for a duplicate", async () => {
    const { db, userId, runId, importId } = await landed("duplicate", {
      withEntry: true,
    });

    const outcome = await getImportOutcome(db, userId, importId);

    expect(outcome?.status).toBe("duplicate");
    expect(outcome?.run?.id).toBe(runId);
    expect(outcome?.run?.entryId).toEqual(expect.any(String));
  });

  it("carries the reason for a file that would not parse, and no run", async () => {
    const db = coreDb();
    const userId = newUlid();
    const importId = newUlid();
    await db.insert(imports).values({
      id: importId,
      userId,
      r2Key: `imports/${userId}/${importId}.gpx`,
      status: "failed",
      failureReason: "This file has no track in it. Export the run again.",
      createdAt: nowSeconds(),
    });

    expect(await getImportOutcome(db, userId, importId)).toStrictEqual({
      status: "failed",
      failureReason: "This file has no track in it. Export the run again.",
      run: undefined,
    });
  });

  it("has no run when the one it pointed at is gone", async () => {
    const { db, userId, runId, importId } = await landed("done");
    await db.delete(runs).where(eq(runs.id, runId));

    const outcome = await getImportOutcome(db, userId, importId);

    expect(outcome?.status).toBe("done");
    expect(outcome?.run).toBeUndefined();
  });
});

describe("startImport: the rules, in the words the user reads", () => {
  const bytes = new TextEncoder().encode("<gpx/>").buffer;

  it("says a file of another type is not one it reads, in round 22's words", async () => {
    // The copy lists them, and the list is the same one the parsers are
    // registered under.
    await expect(
      startImport(
        coreDb(),
        env.IMPORTS,
        fakeQueue(),
        {
          userId: newUlid(),
          filename: "run.csv",
          bytes,
        },
        noReport,
      ),
    ).rejects.toThrow("That's not a GPX, TCX or FIT file.");
  });

  it("caps uploads at 25 MB, in bytes", () => {
    // Pinned as a number, because every other test in this file is written
    // in terms of the constant and would still pass if it were 25 KB.
    expect(MAX_IMPORT_BYTES).toBe(26_214_400);
  });

  it("takes a file of exactly the cap, and refuses one byte more", async () => {
    // `>`, not `>=`: 25 MB is the cap.
    const queue = fakeQueue();
    await expect(
      startImport(
        coreDb(),
        env.IMPORTS,
        queue,
        {
          userId: newUlid(),
          filename: "run.gpx",
          bytes: new ArrayBuffer(MAX_IMPORT_BYTES),
        },
        noReport,
      ),
    ).resolves.toBeTruthy();

    await expect(
      startImport(
        coreDb(),
        env.IMPORTS,
        queue,
        {
          userId: newUlid(),
          filename: "run.gpx",
          bytes: new ArrayBuffer(MAX_IMPORT_BYTES + 1),
        },
        noReport,
      ),
    ).rejects.toThrow(/25 MB/);
  });

  it("says an empty file is empty rather than that it is the wrong type", async () => {
    await expect(
      startImport(
        coreDb(),
        env.IMPORTS,
        fakeQueue(),
        {
          userId: newUlid(),
          filename: "run.gpx",
          bytes: new ArrayBuffer(0),
        },
        noReport,
      ),
    ).rejects.toThrow(/empty/);
  });

  it("keys the stored object by user, import and format", async () => {
    // The consumer reads the format back out of this key, so its shape is
    // a contract between the two halves.
    const userId = newUlid();
    const { importId } = await startImport(
      coreDb(),
      env.IMPORTS,
      fakeQueue(),
      {
        userId,
        filename: "Morning Run.TCX",
        bytes,
      },
      noReport,
    );

    const row = await importRow(userId, importId);
    expect(row?.r2Key).toBe(`imports/${userId}/${importId}.tcx`);
    expect(await env.IMPORTS.get(row?.r2Key ?? "")).not.toBeNull();
  });

  it("returns the first import when the same submission arrives twice", async () => {
    // Law 8b: the key is minted when the form mounts and resent on retry.
    // A repeat must not upload the file again or start a second parse.
    const userId = newUlid();
    const idempotencyKey = newUlid();
    const queue = fakeQueue();

    const first = await startImport(
      coreDb(),
      env.IMPORTS,
      queue,
      {
        userId,
        filename: "run.gpx",
        bytes,
        idempotencyKey,
      },
      noReport,
    );
    const second = await startImport(
      coreDb(),
      env.IMPORTS,
      queue,
      {
        userId,
        filename: "run.gpx",
        bytes,
        idempotencyKey,
      },
      noReport,
    );

    expect(second.importId).toBe(first.importId);
    expect(queue.sent).toHaveLength(1);
  });

  it("does not share an idempotency key across users", async () => {
    // The key is client-generated, so two accounts can mint the same one.
    const idempotencyKey = newUlid();
    const queue = fakeQueue();

    const mine = await startImport(
      coreDb(),
      env.IMPORTS,
      queue,
      {
        userId: newUlid(),
        filename: "run.gpx",
        bytes,
        idempotencyKey,
      },
      noReport,
    );
    const theirs = await startImport(
      coreDb(),
      env.IMPORTS,
      queue,
      {
        userId: newUlid(),
        filename: "run.gpx",
        bytes,
        idempotencyKey,
      },
      noReport,
    );

    expect(theirs.importId).not.toBe(mine.importId);
    expect(queue.sent).toHaveLength(2);
  });

  it("starts a new import each time when no key is given", async () => {
    const userId = newUlid();
    const queue = fakeQueue();

    const first = await startImport(
      coreDb(),
      env.IMPORTS,
      queue,
      {
        userId,
        filename: "run.gpx",
        bytes,
      },
      noReport,
    );
    const second = await startImport(
      coreDb(),
      env.IMPORTS,
      queue,
      {
        userId,
        filename: "run.gpx",
        bytes,
      },
      noReport,
    );

    expect(second.importId).not.toBe(first.importId);
  });

  it("stamps the import in epoch seconds and enqueues its id", async () => {
    const userId = newUlid();
    const queue = fakeQueue();
    const before = nowSeconds();

    const { importId } = await startImport(
      coreDb(),
      env.IMPORTS,
      queue,
      {
        userId,
        filename: "run.gpx",
        bytes,
      },
      noReport,
    );

    const row = await importRow(userId, importId);
    expect(row?.status).toBe("pending");
    expect(row?.createdAt).toBeGreaterThanOrEqual(before - 5);
    expect(row?.createdAt).toBeLessThanOrEqual(before + 5);
    expect(queue.sent).toStrictEqual([{ type: "import", importId }]);
  });
});

/**
A database whose insert fails, as D1 being down would fail it.
*/
function failingInsert() {
  const db = coreDb();
  vi.spyOn(db, "insert").mockImplementation(() => {
    throw new Error("D1 is down");
  });
  return db;
}

async function storedFor(userId: string): Promise<string[]> {
  const listed = await env.IMPORTS.list({ prefix: `imports/${userId}/` });
  return listed.objects.map((object) => object.key);
}

describe("startImport: an upload whose row could not be written (D-110)", () => {
  const bytes = new TextEncoder().encode("<gpx/>").buffer;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("takes its file back out of R2, since no bucket rule will", async () => {
    const userId = newUlid();
    const queue = fakeQueue();
    const report = vi.fn();

    await expect(
      startImport(
        failingInsert(),
        env.IMPORTS,
        queue,
        {
          userId,
          filename: "run.gpx",
          bytes,
        },
        report,
      ),
    ).rejects.toThrow("D1 is down");

    expect(await storedFor(userId)).toStrictEqual([]);
    expect(queue.sent).toStrictEqual([]);
    expect(report).not.toHaveBeenCalled();
  });

  it("still fails with the insert's error when the delete fails too, and reports the delete", async () => {
    const userId = newUlid();
    const r2Failure = new Error("R2 is down");
    vi.spyOn(env.IMPORTS, "delete").mockRejectedValueOnce(r2Failure);
    const report = vi.fn();

    await expect(
      startImport(
        failingInsert(),
        env.IMPORTS,
        fakeQueue(),
        {
          userId,
          filename: "run.gpx",
          bytes,
        },
        report,
      ),
    ).rejects.toThrow("D1 is down");

    // Left for account deletion's purge, which lists the whole prefix.
    const stored = await storedFor(userId);
    expect(stored).toHaveLength(1);
    // Ids to find the stray file by, and nothing of what is in it.
    const importId = stored[0]
      ?.replace(`imports/${userId}/`, "")
      .split(".", 1)[0];
    expect(report).toHaveBeenCalledExactlyOnceWith(r2Failure, {
      surface: "import-orphan-delete",
      userId,
      importId,
    });
  });
});
