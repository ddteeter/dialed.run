import { describe, expect, it } from "vitest";

import { env } from "../../src/env";
import { coreDb } from "../../src/modules/runs/core-db";
import {
  ImportUploadError,
  MAX_IMPORT_BYTES,
  getImportStatus,
  startImport,
} from "../../src/modules/runs/imports";
import { newUlid } from "../../src/lib/ids";
import type { ImportJob } from "../../src/modules/runs/queue-messages";

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

    const status = await getImportStatus(db, userId, importId);
    expect(status?.status).toBe("pending");
    expect(status?.r2Key).toBe(`imports/${userId}/${importId}.gpx`);

    const object = await env.IMPORTS.get(status?.r2Key ?? "");
    expect(object).not.toBeNull();
  });

  it("scopes getImportStatus to the requesting user", async () => {
    const db = coreDb();
    const queue = fakeQueue();
    const userId = newUlid();
    const otherUserId = newUlid();
    const { importId } = await startImport(db, env.IMPORTS, queue, {
      userId,
      filename: "run.tcx",
      bytes: new TextEncoder().encode("<tcx></tcx>").buffer,
    });

    expect(await getImportStatus(db, otherUserId, importId)).toBeUndefined();
    expect(await getImportStatus(db, userId, importId)).toBeDefined();
  });
});

describe("startImport: the rules, in the words the user reads", () => {
  const bytes = new TextEncoder().encode("<gpx/>").buffer;

  it("names the formats it accepts", async () => {
    // The copy lists them, and the list is the same one the parsers are
    // registered under.
    await expect(
      startImport(coreDb(), env.IMPORTS, fakeQueue(), {
        userId: newUlid(),
        filename: "run.csv",
        bytes,
      }),
    ).rejects.toThrow(/fit, gpx, tcx/);
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
    const { importId } = await startImport(
      coreDb(),
      env.IMPORTS,
      fakeQueue(),
      { userId, filename: "Morning Run.TCX", bytes },
    );

    const row = await getImportStatus(coreDb(), userId, importId);
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
    const before = Math.floor(Date.now() / 1000);

    const { importId } = await startImport(coreDb(), env.IMPORTS, queue, {
      userId,
      filename: "run.gpx",
      bytes,
    });

    const row = await getImportStatus(coreDb(), userId, importId);
    expect(row?.status).toBe("pending");
    expect(row?.createdAt).toBeGreaterThanOrEqual(before - 5);
    expect(row?.createdAt).toBeLessThanOrEqual(before + 5);
    expect(queue.sent).toStrictEqual([{ type: "import", importId }]);
  });
});
