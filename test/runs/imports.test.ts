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
