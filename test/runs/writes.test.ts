import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import { gaveUpClear } from "../../src/modules/ops/gave-up/gave-up";
import { gaveUp, imports, outbox, runs } from "../../src/db/schema-core";
import { env } from "../../src/env";
import type { GaveUpKind } from "../../src/lib/contracts/gave-up";
import { newUlid } from "../../src/lib/ids";
import { dedupeKeyFor } from "../../src/lib/sql/outbox";
import { oweOutbox, outboxInsert } from "../../src/modules/ops/outbox/outbox";
import {
  retryFailedImport,
  retryFailedWeather,
  runEffortStatement,
} from "../../src/modules/runs/writes";
import type { ImportJob } from "../../src/modules/runs/queue-messages";

/**
 * Design 275: the writes `runs` makes when another module asks. The Desk's
 * retries are driven end to end in `test/ops/gave-up.test.ts`; these pin
 * each export alone, with a Desk row standing in for what is settled.
 */

const NOW = 1_757_000_000;

function db() {
  return drizzle(env.DIALED_CORE);
}

async function deskRow(kind: GaveUpKind, subjectId: string): Promise<void> {
  await db().insert(gaveUp).values({
    id: newUlid(),
    kind,
    subjectId,
    reason: "gave up",
    tries: 3,
    firstFailedAt: NOW,
    lastFailedAt: NOW,
  });
}

async function deskRowsFor(subjectId: string): Promise<number> {
  return db().$count(gaveUp, eq(gaveUp.subjectId, subjectId));
}

async function failedImport(
  status: "failed" | "done" = "failed",
): Promise<{ id: string; userId: string; r2Key: string }> {
  const id = newUlid();
  const userId = newUlid();
  const r2Key = `imports/${userId}/${id}.fit`;
  await db().insert(imports).values({
    id,
    userId,
    r2Key,
    status,
    failureReason: "We couldn't process this import after several tries.",
    createdAt: NOW,
  });
  await deskRow("import", id);
  return { id, userId, r2Key };
}

async function importOf(id: string) {
  const [row] = await db().select().from(imports).where(eq(imports.id, id));
  return row;
}

function owedExpiry(userId: string, key: string) {
  return oweOutbox({ kind: "import_file_expire", payload: { userId, key } });
}

async function owedCount(userId: string, key: string): Promise<number> {
  const dedupeKey = dedupeKeyFor({
    kind: "import_file_expire",
    payload: { userId, key },
  });
  return db().$count(outbox, eq(outbox.dedupeKey, dedupeKey));
}

interface Recorded {
  readonly sent: ImportJob[];
  readonly reported: { error: unknown; context: Record<string, string> }[];
}

function importDeps(
  importId: string,
  options: { hasFile?: boolean; sendFails?: boolean } = {},
) {
  const recorded: Recorded = { sent: [], reported: [] };
  return {
    recorded,
    deps: {
      settle: () => gaveUpClear(db(), "import", importId),
      queue: {
        send: (message: ImportJob) => {
          recorded.sent.push(message);
          return options.sendFails === true
            ? Promise.reject(new Error("queue down"))
            : Promise.resolve();
        },
      },
      importFileExists: () => Promise.resolve(options.hasFile ?? true),
      report: (error: unknown, context: Record<string, string>) => {
        recorded.reported.push({ error, context });
      },
    },
  };
}

describe("retryFailedImport", () => {
  it("moves a failed import to pending, cancels only its owed expiry, settles the row and sends it", async () => {
    const theirs = await failedImport();
    const other = await failedImport();
    await outboxInsert(db(), owedExpiry(theirs.userId, theirs.r2Key));
    await outboxInsert(db(), owedExpiry(other.userId, other.r2Key));
    const { deps, recorded } = importDeps(theirs.id);
    expect(await retryFailedImport(db(), theirs.id, deps)).toBe("retried");
    const retried = await importOf(theirs.id);
    expect(retried?.status).toBe("pending");
    expect(retried?.failureReason).toBeNull();
    expect(await owedCount(theirs.userId, theirs.r2Key)).toBe(0);
    expect(await owedCount(other.userId, other.r2Key)).toBe(1);
    expect(await deskRowsFor(theirs.id)).toBe(0);
    expect(await deskRowsFor(other.id)).toBe(1);
    expect(recorded.sent).toHaveLength(1);
    expect(recorded.sent[0]).toMatchObject({
      type: "import",
      importId: theirs.id,
    });
    expect(recorded.reported).toStrictEqual([]);
  });

  it("leaves an import that is no longer failed as it is", async () => {
    const done = await failedImport("done");
    const { deps } = importDeps(done.id);
    expect(await retryFailedImport(db(), done.id, deps)).toBe("retried");
    expect(await importOf(done.id)).toMatchObject({ status: "done" });
  });

  it("reports a send that fails, and still says it retried", async () => {
    const theirs = await failedImport();
    const { deps, recorded } = importDeps(theirs.id, { sendFails: true });
    expect(await retryFailedImport(db(), theirs.id, deps)).toBe("retried");
    expect(await importOf(theirs.id)).toMatchObject({ status: "pending" });
    expect(recorded.reported).toHaveLength(1);
    expect(recorded.reported[0]?.context).toStrictEqual({
      surface: "desk-retry-import",
      importId: theirs.id,
    });
  });

  it("settles the row and sends nothing when the file has gone", async () => {
    const theirs = await failedImport();
    await outboxInsert(db(), owedExpiry(theirs.userId, theirs.r2Key));
    const { deps, recorded } = importDeps(theirs.id, { hasFile: false });
    expect(await retryFailedImport(db(), theirs.id, deps)).toBe("gone");
    expect(await importOf(theirs.id)).toMatchObject({ status: "failed" });
    expect(await owedCount(theirs.userId, theirs.r2Key)).toBe(1);
    expect(await deskRowsFor(theirs.id)).toBe(0);
    expect(recorded.sent).toStrictEqual([]);
  });

  it("settles the row and sends nothing when the import has gone", async () => {
    const id = newUlid();
    await deskRow("import", id);
    const { deps, recorded } = importDeps(id);
    expect(await retryFailedImport(db(), id, deps)).toBe("gone");
    expect(await deskRowsFor(id)).toBe(0);
    expect(recorded.sent).toStrictEqual([]);
  });
});

async function runWith(
  weatherStatus: "failed" | "attached",
  userId = newUlid(),
): Promise<string> {
  const id = newUlid();
  await db().insert(runs).values({
    id,
    userId,
    source: "manual",
    title: "Morning run",
    startedAt: NOW,
    durationS: 1800,
    distanceM: 5000,
    weatherStatus,
  });
  return id;
}

async function runOf(id: string) {
  const [row] = await db().select().from(runs).where(eq(runs.id, id));
  return row;
}

describe("retryFailedWeather", () => {
  it("puts a failed run's weather back to pending and settles the row", async () => {
    const id = await runWith("failed");
    await deskRow("weather", id);
    const settle = () => gaveUpClear(db(), "weather", id);
    expect(await retryFailedWeather(db(), id, settle)).toBe("retried");
    expect(await runOf(id)).toMatchObject({ weatherStatus: "pending" });
    expect(await deskRowsFor(id)).toBe(0);
  });

  it("leaves weather that is no longer failed as it is", async () => {
    const id = await runWith("attached");
    const settle = () => gaveUpClear(db(), "weather", id);
    expect(await retryFailedWeather(db(), id, settle)).toBe("retried");
    expect(await runOf(id)).toMatchObject({ weatherStatus: "attached" });
  });

  it("is gone, with the row settled, when the run is", async () => {
    const id = newUlid();
    await deskRow("weather", id);
    const settle = () => gaveUpClear(db(), "weather", id);
    expect(await retryFailedWeather(db(), id, settle)).toBe("gone");
    expect(await deskRowsFor(id)).toBe(0);
  });
});

describe("runEffortStatement", () => {
  it("writes the runner's own pick of effort on their own run only", async () => {
    const userId = newUlid();
    const theirs = await runWith("attached", userId);
    const someoneElses = await runWith("attached");
    await db().batch([
      runEffortStatement(db(), { runId: theirs, userId }, "race"),
      runEffortStatement(db(), { runId: someoneElses, userId }, "race"),
    ]);
    expect(await runOf(theirs)).toMatchObject({
      effort: "race",
      effortSource: "runner",
    });
    const untouched = await runOf(someoneElses);
    expect(untouched?.effort).toBeNull();
    expect(untouched?.effortSource).toBeNull();
  });
});
