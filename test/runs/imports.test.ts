import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

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
import { selectOwnedRow } from "../../src/lib/owned";
import type { ImportJob } from "../../src/modules/runs/queue-messages";
import { nowSeconds } from "../../src/lib/now";

/**
The stored row, read the way the module reads it — owner-scoped.
*/
async function importRow(userId: string, importId: string) {
  return selectOwnedRow(coreDb(), imports, { id: importId, userId });
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
      startImport(db, env.IMPORTS, queue, {
        userId: newUlid(),
        filename: "run.pdf",
        bytes: new ArrayBuffer(10),
      }),
    ).rejects.toBeInstanceOf(ImportUploadError);
  });

  it("rejects an empty file", async () => {
    const db = coreDb();
    const queue = fakeQueue();
    await expect(
      startImport(db, env.IMPORTS, queue, {
        userId: newUlid(),
        filename: "run.gpx",
        bytes: new ArrayBuffer(0),
      }),
    ).rejects.toBeInstanceOf(ImportUploadError);
  });

  it("rejects a file over the 25 MB cap", async () => {
    const db = coreDb();
    const queue = fakeQueue();
    await expect(
      startImport(db, env.IMPORTS, queue, {
        userId: newUlid(),
        filename: "run.fit",
        bytes: new ArrayBuffer(MAX_IMPORT_BYTES + 1),
      }),
    ).rejects.toBeInstanceOf(ImportUploadError);
  });

  it("stores the file to R2, records a pending import, and enqueues the job", async () => {
    const db = coreDb();
    const queue = fakeQueue();
    const userId = newUlid();
    const bytes = new TextEncoder().encode("<gpx></gpx>").buffer;

    const { importId } = await startImport(db, env.IMPORTS, queue, {
      userId,
      filename: "run.gpx",
      bytes,
    });

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
    const { importId } = await startImport(db, env.IMPORTS, queue, {
      userId,
      filename: "run.tcx",
      bytes: new TextEncoder().encode("<tcx></tcx>").buffer,
    });

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
      isPublic: true,
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
      startImport(coreDb(), env.IMPORTS, fakeQueue(), {
        userId: newUlid(),
        filename: "run.csv",
        bytes,
      }),
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
      startImport(coreDb(), env.IMPORTS, queue, {
        userId: newUlid(),
        filename: "run.gpx",
        bytes: new ArrayBuffer(MAX_IMPORT_BYTES),
      }),
    ).resolves.toBeTruthy();

    await expect(
      startImport(coreDb(), env.IMPORTS, queue, {
        userId: newUlid(),
        filename: "run.gpx",
        bytes: new ArrayBuffer(MAX_IMPORT_BYTES + 1),
      }),
    ).rejects.toThrow(/25 MB/);
  });

  it("says an empty file is empty rather than that it is the wrong type", async () => {
    await expect(
      startImport(coreDb(), env.IMPORTS, fakeQueue(), {
        userId: newUlid(),
        filename: "run.gpx",
        bytes: new ArrayBuffer(0),
      }),
    ).rejects.toThrow(/empty/);
  });

  it("keys the stored object by user, import and format", async () => {
    // The consumer reads the format back out of this key, so its shape is
    // a contract between the two halves.
    const userId = newUlid();
    const { importId } = await startImport(coreDb(), env.IMPORTS, fakeQueue(), {
      userId,
      filename: "Morning Run.TCX",
      bytes,
    });

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

    const first = await startImport(coreDb(), env.IMPORTS, queue, {
      userId,
      filename: "run.gpx",
      bytes,
      idempotencyKey,
    });
    const second = await startImport(coreDb(), env.IMPORTS, queue, {
      userId,
      filename: "run.gpx",
      bytes,
      idempotencyKey,
    });

    expect(second.importId).toBe(first.importId);
    expect(queue.sent).toHaveLength(1);
  });

  it("does not share an idempotency key across users", async () => {
    // The key is client-generated, so two accounts can mint the same one.
    const idempotencyKey = newUlid();
    const queue = fakeQueue();

    const mine = await startImport(coreDb(), env.IMPORTS, queue, {
      userId: newUlid(),
      filename: "run.gpx",
      bytes,
      idempotencyKey,
    });
    const theirs = await startImport(coreDb(), env.IMPORTS, queue, {
      userId: newUlid(),
      filename: "run.gpx",
      bytes,
      idempotencyKey,
    });

    expect(theirs.importId).not.toBe(mine.importId);
    expect(queue.sent).toHaveLength(2);
  });

  it("starts a new import each time when no key is given", async () => {
    const userId = newUlid();
    const queue = fakeQueue();

    const first = await startImport(coreDb(), env.IMPORTS, queue, {
      userId,
      filename: "run.gpx",
      bytes,
    });
    const second = await startImport(coreDb(), env.IMPORTS, queue, {
      userId,
      filename: "run.gpx",
      bytes,
    });

    expect(second.importId).not.toBe(first.importId);
  });

  it("stamps the import in epoch seconds and enqueues its id", async () => {
    const userId = newUlid();
    const queue = fakeQueue();
    const before = nowSeconds();

    const { importId } = await startImport(coreDb(), env.IMPORTS, queue, {
      userId,
      filename: "run.gpx",
      bytes,
    });

    const row = await importRow(userId, importId);
    expect(row?.status).toBe("pending");
    expect(row?.createdAt).toBeGreaterThanOrEqual(before - 5);
    expect(row?.createdAt).toBeLessThanOrEqual(before + 5);
    expect(queue.sent).toStrictEqual([{ type: "import", importId }]);
  });
});
