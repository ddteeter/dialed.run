import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  gaveUpClear,
  gaveUpUpsert,
  giveUpEach,
  type GaveUpWrites,
} from "../../src/db/gave-up";
import { gaveUp, imports } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { gaveUpRow } from "../gave-up-rows";
import { batchOf, fakeMessage } from "../queue-fakes";

/**
 * The two writes behind the Desk's Gave up (R-119), and the dead-letter
 * loop that puts a job's own writes and its row in one batch.
 */

function db() {
  return drizzle(env.DIALED_CORE);
}

beforeEach(async () => {
  await db().delete(gaveUp);
});

describe("gaveUpUpsert", () => {
  it("records a job that gave up, first and last at the same moment", async () => {
    await gaveUpUpsert(
      db(),
      {
        kind: "weather",
        subjectId: "run-1",
        reason: "No weather.",
        rawError: "boom",
        tries: 5,
      },
      1000,
    );

    expect(await gaveUpRow("weather", "run-1")).toMatchObject({
      reason: "No weather.",
      rawError: "boom",
      tries: 5,
      firstFailedAt: 1000,
      lastFailedAt: 1000,
    });
  });

  it("stores no raw error when the writer had none", async () => {
    await gaveUpUpsert(db(), {
      kind: "weather",
      subjectId: "run-2",
      reason: "No weather.",
      tries: 1,
    });

    const row = await gaveUpRow("weather", "run-2");
    expect(row?.rawError).toBeNull();
  });

  it("makes a job that gives up again the same row: tries add, the first failure stays", async () => {
    const first = { kind: "enrichment", subjectId: "p-1", tries: 1 } as const;
    await gaveUpUpsert(
      db(),
      { ...first, reason: "Old.", rawError: "old" },
      1000,
    );
    await gaveUpUpsert(db(), { ...first, reason: "New.", tries: 4 }, 5000);

    const rows = await db().select().from(gaveUp);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rawError).toBeNull();
    expect(rows[0]).toMatchObject({
      reason: "New.",
      tries: 5,
      firstFailedAt: 1000,
      lastFailedAt: 5000,
    });
  });

  it("keeps the same subject under two kinds apart", async () => {
    const fact = { subjectId: "same", reason: "x", tries: 1 };
    await gaveUpUpsert(db(), { ...fact, kind: "import" });
    await gaveUpUpsert(db(), { ...fact, kind: "weather" });

    expect(await db().select().from(gaveUp)).toHaveLength(2);
  });
});

describe("gaveUpClear", () => {
  it("forgets one job and only that one", async () => {
    const fact = { reason: "x", tries: 1 };
    await gaveUpUpsert(db(), { ...fact, kind: "import", subjectId: "a" });
    await gaveUpUpsert(db(), { ...fact, kind: "import", subjectId: "b" });
    await gaveUpUpsert(db(), { ...fact, kind: "weather", subjectId: "a" });

    await gaveUpClear(db(), "import", "a");

    expect(await gaveUpRow("import", "a")).toBeUndefined();
    expect(await gaveUpRow("import", "b")).toBeDefined();
    expect(await gaveUpRow("weather", "a")).toBeDefined();
  });

  it("is a no-op for a job with no row", async () => {
    await expect(gaveUpClear(db(), "import", "none")).resolves.toBeDefined();
  });
});

/**
A dead letter's own write, beside its row, so the batch is seen to carry both.
*/
function writesFor(job: { id: string }) {
  return Promise.resolve({
    subject: { kind: "import" as const, subjectId: job.id },
    writes: [
      db().insert(imports).values({
        id: job.id,
        userId: "u",
        r2Key: "k",
        status: "failed",
        createdAt: 1,
      }),
    ],
  });
}

function handlers(
  onJob: (job: { id: string }) => Promise<GaveUpWrites | undefined>,
) {
  return {
    db: db(),
    tries: 4,
    onJob: vi.fn(onJob),
    deadLettered: "dead-lettered test message",
    captureException: vi.fn(),
  };
}

describe("giveUpEach", () => {
  const jobSchema = z.object({ id: z.string() });

  it("writes the job's own writes and its Gave up row together, then reports and acks", async () => {
    const id = newUlid();
    const h = handlers(writesFor);
    const message = fakeMessage("d1", { id });

    await giveUpEach(batchOf("q-dlq", [message]), jobSchema, h);

    const gaveUpAs = await gaveUpRow("import", id);
    expect(gaveUpAs?.rawError).toBeNull();
    expect(gaveUpAs).toMatchObject({
      reason:
        "It failed every try the queue gives a job, so the queue stopped. Each error is in Sentry.",
      tries: 4,
    });
    const [row] = await db().select().from(imports).where(eq(imports.id, id));
    expect(row).toBeDefined();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(h.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "dead-lettered test message" }),
      { queue: "q-dlq", messageId: "d1" },
    );
  });

  it("writes a row with no other writes, for a job that has nothing else", async () => {
    const h = handlers((job) =>
      Promise.resolve({
        subject: { kind: "reminder" as const, subjectId: job.id },
        writes: [],
      }),
    );

    await giveUpEach(
      batchOf("q-dlq", [fakeMessage("d2", { id: "r-1" })]),
      jobSchema,
      h,
    );

    expect(await gaveUpRow("reminder", "r-1")).toBeDefined();
  });

  it("writes nothing for a job its handler has nothing to record for, and still acks", async () => {
    const h = handlers(() => Promise.resolve(undefined));
    const message = fakeMessage("d3", { id: "x" });

    await giveUpEach(batchOf("q-dlq", [message]), jobSchema, h);

    expect(await db().select().from(gaveUp)).toStrictEqual([]);
    expect(message.ack).toHaveBeenCalledTimes(1);
  });

  it("asks nothing of a body that does not parse, and reports and acks it", async () => {
    const h = handlers(writesFor);
    const message = fakeMessage("d4", "garbage");

    await giveUpEach(batchOf("q-dlq", [message]), jobSchema, h);

    expect(h.onJob).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(h.captureException).toHaveBeenCalledTimes(1);
  });
});
