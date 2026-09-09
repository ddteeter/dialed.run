import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  imports,
  notifications,
  runs,
  stravaConnections,
  stravaRevocations,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { coreDb } from "../../src/modules/runs/core-db";
import {
  handleImportsBatch,
  handleImportsDlqBatch,
  importFailureReason,
} from "../../src/modules/runs/consumer";
import type { ConsumerDeps } from "../../src/modules/runs/consumer";
import { PARSE_FAILURE_MESSAGE } from "../../src/modules/runs/parsers";
import { RunParseError } from "../../src/modules/runs/parsers/shared";
import { createManualRun } from "../../src/modules/runs/service";
import { unreadNotificationCount } from "../../src/modules/notifications";
import validTcx from "./fixtures/valid.tcx?raw";
import malformedTcx from "./fixtures/malformed.tcx?raw";
import treadmillTcx from "./fixtures/treadmill.tcx?raw";

function fakeMessage(body: unknown) {
  let wasAcked = false;
  let wasRetried = false;
  return {
    message: {
      id: newUlid(),
      timestamp: new Date(),
      body,
      attempts: 1,
      ack: () => {
        wasAcked = true;
      },
      retry: () => {
        wasRetried = true;
      },
    },
    get wasAcked() {
      return wasAcked;
    },
    get wasRetried() {
      return wasRetried;
    },
  };
}

function fakeBatch(messages: readonly { body: unknown }[]) {
  const wrapped = messages.map((m) => fakeMessage(m.body));
  const batch: MessageBatch = {
    queue: "dialed-imports",
    metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
    messages: wrapped.map((w) => w.message),
    ackAll: () => {
      /*
      noop
      */
    },
    retryAll: () => {
      /*
      noop
      */
    },
  };
  return { batch, wrapped };
}

function makeDeps(overrides: Partial<ConsumerDeps> = {}): ConsumerDeps & {
  exceptions: { error: unknown; context: Record<string, string> }[];
} {
  const exceptions: { error: unknown; context: Record<string, string> }[] =
    [];
  return {
    db: coreDb(),
    importBucket: env.IMPORTS,
    captureException: (error, context) => {
      exceptions.push({ error, context });
    },
    exceptions,
    ...overrides,
  };
}

async function seedImport(
  db: ReturnType<typeof coreDb>,
  userId: string,
  content: string,
  extension: string,
): Promise<string> {
  const importId = newUlid();
  const r2Key = `imports/${userId}/${importId}.${extension}`;
  await env.IMPORTS.put(r2Key, new TextEncoder().encode(content));
  await db.insert(imports).values({
    id: importId,
    userId,
    r2Key,
    status: "pending",
    createdAt: Math.floor(Date.now() / 1000),
  });
  return importId;
}

describe("handleImportsBatch (102 §4, §8)", () => {
  it("happy path: parses, inserts a run, marks the import done, and notifies", async () => {
    const deps = makeDeps();
    const userId = newUlid();
    const importId = await seedImport(deps.db, userId, validTcx, "tcx");

    const { batch } = fakeBatch([{ body: { type: "import", importId } }]);
    await handleImportsBatch(batch, deps);

    const [importRow] = await deps.db
      .select()
      .from(imports)
      .where(eq(imports.id, importId));
    expect(importRow?.status).toBe("done");
    expect(importRow?.runId).not.toBeNull();

    const [runRow] = await deps.db
      .select()
      .from(runs)
      .where(eq(runs.id, importRow?.runId ?? ""));
    expect(runRow?.source).toBe("file");
    expect(runRow?.distanceM).toBe(5000);

    expect(await unreadNotificationCount(deps.db, userId)).toBe(1);
  });

  it("is idempotent on redelivery — a second delivery inserts no second run", async () => {
    const deps = makeDeps();
    const userId = newUlid();
    const importId = await seedImport(deps.db, userId, validTcx, "tcx");
    const { batch } = fakeBatch([{ body: { type: "import", importId } }]);

    await handleImportsBatch(batch, deps);
    await handleImportsBatch(fakeBatch([{ body: { type: "import", importId } }]).batch, deps);

    const runRows = await deps.db
      .select()
      .from(runs)
      .where(eq(runs.userId, userId));
    expect(runRows).toHaveLength(1);
  });

  it("a malformed file fails the import with a user-facing reason, never throwing", async () => {
    const deps = makeDeps();
    const userId = newUlid();
    const importId = await seedImport(deps.db, userId, malformedTcx, "tcx");
    const { batch, wrapped } = fakeBatch([
      { body: { type: "import", importId } },
    ]);

    await handleImportsBatch(batch, deps);

    expect(wrapped[0]?.wasAcked).toBe(true);
    const [importRow] = await deps.db
      .select()
      .from(imports)
      .where(eq(imports.id, importId));
    expect(importRow?.status).toBe("failed");
    expect(importRow?.failureReason).toBeTruthy();
    expect(await unreadNotificationCount(deps.db, userId)).toBe(1);
  });

  it("a file matching an existing run within ±120s completes as 'duplicate'", async () => {
    const deps = makeDeps();
    const userId = newUlid();
    // valid.tcx starts at 2026-08-15T12:00:00Z.
    const existing = await createManualRun(deps.db, userId, {
      startedAt: Math.floor(new Date("2026-08-15T12:00:30Z").getTime() / 1000),
      durationS: 1800,
      distanceM: 5000,
      indoor: false,
      title: "Already logged",
    });
    const importId = await seedImport(deps.db, userId, validTcx, "tcx");
    const { batch } = fakeBatch([{ body: { type: "import", importId } }]);

    await handleImportsBatch(batch, deps);

    const [importRow] = await deps.db
      .select()
      .from(imports)
      .where(eq(imports.id, importId));
    expect(importRow?.status).toBe("duplicate");
    expect(importRow?.runId).toBe(existing.id);
  });

  it("degrades when attachObservation throws — the run still saves as pending", async () => {
    const deps = makeDeps({
      attachObservation: () => Promise.reject(new Error("weather is down")),
    });
    const userId = newUlid();
    // Give the run resolvable coordinates so weather status is 'pending'.
    const gpxWithCoords = `<?xml version="1.0"?><gpx><trk><trkseg>
      <trkpt lat="44.9" lon="-93.2"><time>2026-08-16T08:00:00Z</time></trkpt>
      <trkpt lat="44.91" lon="-93.21"><time>2026-08-16T08:30:00Z</time></trkpt>
    </trkseg></trk></gpx>`;
    const importId = await seedImport(deps.db, userId, gpxWithCoords, "gpx");
    const { batch } = fakeBatch([{ body: { type: "import", importId } }]);

    await handleImportsBatch(batch, deps);

    const [importRow] = await deps.db
      .select()
      .from(imports)
      .where(eq(imports.id, importId));
    expect(importRow?.status).toBe("done");
    const [runRow] = await deps.db
      .select()
      .from(runs)
      .where(eq(runs.id, importRow?.runId ?? ""));
    expect(runRow?.weatherStatus).toBe("pending");
    expect(deps.exceptions.some((e) => e.context.surface === "attachObservation")).toBe(true);
  });

  it("an invalid queue message is acked, never retried", async () => {
    const deps = makeDeps();
    const { batch, wrapped } = fakeBatch([{ body: { garbage: true } }]);
    await handleImportsBatch(batch, deps);
    expect(wrapped[0]?.wasAcked).toBe(true);
    expect(wrapped[0]?.wasRetried).toBe(false);

    // Structurally-invalid garbage is a deploy-shaped problem (law 9), so
    // the report has to name which queue and which message.
    expect((deps.exceptions[0]?.error as Error).message).toBe(
      "invalid imports queue message",
    );
    expect(deps.exceptions[0]?.context).toStrictEqual({
      queue: "dialed-imports",
      messageId: batch.messages[0]?.id,
    });
  });

  /**
   * The webhook now enqueues and returns, so resolving athlete -> user and
   * deduping the event both happen here. These moved with the logic.
   */
  it("a strava_reminder job resolves the athlete and notifies (D-33)", async () => {
    const deps = makeDeps();
    const athleteId = newUlid();
    const userId = await connectAthlete(deps.db, athleteId);
    const { batch } = fakeBatch([{ body: reminderJob({ athleteId }) }]);

    await handleImportsBatch(batch, deps);

    expect(await unreadNotificationCount(deps.db, userId)).toBe(1);
  });

  it("notifies once when the same event is delivered twice", async () => {
    const deps = makeDeps();
    const athleteId = newUlid();
    const userId = await connectAthlete(deps.db, athleteId);
    const job = reminderJob({ athleteId });

    await handleImportsBatch(fakeBatch([{ body: job }]).batch, deps);
    await handleImportsBatch(fakeBatch([{ body: job }]).batch, deps);

    // Queue delivery is at-least-once, so this is the ordinary case, not
    // an edge one. The claim is an INSERT OR IGNORE on the event key.
    expect(await unreadNotificationCount(deps.db, userId)).toBe(1);
  });

  it("drops an event for an athlete nobody has connected", async () => {
    const deps = makeDeps();
    const { batch, wrapped } = fakeBatch([
      { body: reminderJob({ athleteId: "999999" }) },
    ]);

    await handleImportsBatch(batch, deps);

    // Acked, not retried: an unknown athlete is a permanent condition, and
    // the webhook enqueues before it can know.
    expect(wrapped[0]?.wasAcked).toBe(true);
    expect(wrapped[0]?.wasRetried).toBe(false);
  });
});

function reminderJob(
  overrides: Partial<{ athleteId: string; objectId: string }> = {},
): Record<string, unknown> {
  return {
    type: "strava_reminder",
    athleteId: overrides.athleteId ?? "111",
    objectId: overrides.objectId ?? newUlid(),
    aspectType: "create",
    eventTime: Math.floor(Date.now() / 1000),
  };
}

async function connectAthlete(
  db: ReturnType<typeof coreDb>,
  athleteId: string,
): Promise<string> {
  const userId = newUlid();
  await db.insert(stravaConnections).values({
    userId,
    athleteId,
    accessToken: "access",
    refreshToken: "refresh",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    status: "ok",
  });
  return userId;
}

async function failedImportCount(
  db: ReturnType<typeof coreDb>,
): Promise<number> {
  const rows = await db
    .select()
    .from(imports)
    .where(eq(imports.status, "failed"));
  return rows.length;
}

describe("handleImportsDlqBatch (102 §8 — DLQ ownership)", () => {
  it("marks a dead-lettered import failed and notifies the user; no import ends in silence", async () => {
    const deps = makeDeps();
    const userId = newUlid();
    const importId = await seedImport(deps.db, userId, validTcx, "tcx");
    const { batch, wrapped } = fakeBatch([
      { body: { type: "import", importId } },
    ]);

    await handleImportsDlqBatch(batch, deps);

    expect(wrapped[0]?.wasAcked).toBe(true);
    const [importRow] = await deps.db
      .select()
      .from(imports)
      .where(eq(imports.id, importId));
    expect(importRow?.status).toBe("failed");
    // The runner reads this one, so it says what to do next rather than
    // what went wrong inside.
    expect(importRow?.failureReason).toBe(
      "We couldn't process this import after several tries. Try uploading it again.",
    );
    expect(await unreadNotificationCount(deps.db, userId)).toBe(1);
    expect((deps.exceptions[0]?.error as Error).message).toBe(
      "dead-lettered dialed-imports message",
    );
    expect(deps.exceptions[0]?.context).toStrictEqual({
      queue: "dialed-imports",
      messageId: batch.messages[0]?.id,
    });
  });

  it("reports a dead-lettered reminder without inventing an import to fail", async () => {
    // A reminder has no user-visible entity to mark, so the DLQ handler's
    // import branch must not run for it — there is nothing to look up.
    const deps = makeDeps();
    const { batch, wrapped } = fakeBatch([
      {
        body: {
          type: "strava_reminder",
          athleteId: "1",
          objectId: "2",
          aspectType: "create",
          eventTime: 1_700_000_000,
        },
      },
    ]);

    // These tests share a database, so the assertion is on the change,
    // not on the total.
    const failedBefore = await failedImportCount(deps.db);
    await handleImportsDlqBatch(batch, deps);

    expect(wrapped[0]?.wasAcked).toBe(true);
    expect(deps.exceptions).toHaveLength(1);
    expect(await failedImportCount(deps.db)).toBe(failedBefore);
  });

  it("is a no-op on an import whose row has gone", async () => {
    // Same branch, other half: the row is looked up and may not be there.
    const deps = makeDeps();
    const { batch, wrapped } = fakeBatch([
      { body: { type: "import", importId: newUlid() } },
    ]);

    await expect(
      handleImportsDlqBatch(batch, deps),
    ).resolves.toBeUndefined();

    expect(wrapped[0]?.wasAcked).toBe(true);
    expect(deps.exceptions).toHaveLength(1);
  });

  it("is a no-op on an import that already reached a terminal state", async () => {
    const deps = makeDeps();
    const userId = newUlid();
    const importId = await seedImport(deps.db, userId, validTcx, "tcx");
    await deps.db
      .update(imports)
      .set({ status: "done", runId: newUlid() })
      .where(and(eq(imports.id, importId), eq(imports.userId, userId)));

    const { batch } = fakeBatch([{ body: { type: "import", importId } }]);
    await handleImportsDlqBatch(batch, deps);

    expect(await unreadNotificationCount(deps.db, userId)).toBe(0);
  });
});

describe("the import consumer's quieter paths", () => {
  it("reports an import whose row has gone, without throwing", async () => {
    // Shouldn't happen — a job exists because a row did — so the only
    // useful thing to do is say so and let the message ack.
    const deps = makeDeps();
    const missingId = newUlid();
    const { batch, wrapped } = fakeBatch([
      { body: { type: "import", importId: missingId } },
    ]);

    await handleImportsBatch(batch, deps);

    expect(wrapped[0]?.wasAcked).toBe(true);
    expect((deps.exceptions[0]?.error as Error).message).toBe(
      "import row missing for queue job",
    );
    expect(deps.exceptions[0]?.context).toStrictEqual({ importId: missingId });
  });

  it("fails an import whose file has gone from storage", async () => {
    // R2 and the row are two systems (law 8c). A row pointing at nothing
    // is a failure the user can act on, not a crash.
    const db = coreDb();
    const userId = newUlid();
    const importId = await seedImport(db, userId, validTcx, "tcx");
    const [row] = await db.select().from(imports).where(eq(imports.id, importId));
    await env.IMPORTS.delete(row?.r2Key ?? "");

    const { batch } = fakeBatch([{ body: { type: "import", importId } }]);
    await handleImportsBatch(batch, makeDeps());

    const [after] = await db.select().from(imports).where(eq(imports.id, importId));
    expect(after?.status).toBe("failed");
    expect(after?.failureReason).toMatch(/didn't parse/);
  });

  it("fails an import whose key names a format it cannot read", async () => {
    const db = coreDb();
    const userId = newUlid();
    const importId = newUlid();
    const r2Key = `imports/${userId}/${importId}.csv`;
    await env.IMPORTS.put(r2Key, new TextEncoder().encode("a,b,c"));
    await db.insert(imports).values({
      id: importId,
      userId,
      r2Key,
      status: "pending",
      createdAt: Math.floor(Date.now() / 1000),
    });

    const { batch } = fakeBatch([{ body: { type: "import", importId } }]);
    await handleImportsBatch(batch, makeDeps());

    const [after] = await db.select().from(imports).where(eq(imports.id, importId));
    expect(after?.status).toBe("failed");
    expect(after?.failureReason).toMatch(/didn't parse/);
  });

  it("leaves an already-failed import alone on redelivery", async () => {
    // `failed`, `done` and `duplicate` are terminal: a redelivered job is
    // a no-op rather than a second attempt at work already concluded.
    const db = coreDb();
    const userId = newUlid();
    const importId = await seedImport(db, userId, malformedTcx, "tcx");
    const { batch: first } = fakeBatch([{ body: { type: "import", importId } }]);
    await handleImportsBatch(first, makeDeps());
    await db
      .update(imports)
      .set({ failureReason: "the original reason" })
      .where(eq(imports.id, importId));

    const { batch: second } = fakeBatch([
      { body: { type: "import", importId } },
    ]);
    await handleImportsBatch(second, makeDeps());

    const [after] = await db.select().from(imports).where(eq(imports.id, importId));
    expect(after?.failureReason).toBe("the original reason");
  });

  it("names the run it just imported in the reminder it sends", async () => {
    const db = coreDb();
    const userId = newUlid();
    const importId = await seedImport(db, userId, validTcx, "tcx");

    const { batch } = fakeBatch([{ body: { type: "import", importId } }]);
    await handleImportsBatch(batch, makeDeps());

    const [after] = await db.select().from(imports).where(eq(imports.id, importId));
    expect(after?.status).toBe("done");
    expect(after?.runId).toBeTruthy();
    expect(await unreadNotificationCount(db, userId)).toBe(1);
  });

  it("retries a message whose work threw, rather than acking it", async () => {
    // The only path that retries: an unexpected failure, where redelivery
    // is the retry mechanism (law 3). A parse failure is not one of these
    // — that is a conclusion, and it acks.
    const db = coreDb();
    const userId = newUlid();
    const importId = await seedImport(db, userId, validTcx, "tcx");
    const deps = makeDeps({
      db,
      importBucket: {
        get: () => Promise.reject(new Error("R2 unavailable")),
      },
    });
    const { batch, wrapped } = fakeBatch([
      { body: { type: "import", importId } },
    ]);

    await handleImportsBatch(batch, deps);

    expect(wrapped[0]?.wasRetried).toBe(true);
    expect(wrapped[0]?.wasAcked).toBe(false);
    expect(deps.exceptions).toHaveLength(1);
    expect((deps.exceptions[0]?.error as Error).message).toBe("R2 unavailable");
    expect(deps.exceptions[0]?.context).toStrictEqual({
      queue: "dialed-imports",
      messageId: batch.messages[0]?.id,
    });
  });
});

async function seedRevocation(accessToken = "token"): Promise<string> {
  const id = newUlid();
  await coreDb().insert(stravaRevocations).values({
    id,
    accessToken,
    createdAt: Math.floor(Date.now() / 1000),
  });
  return id;
}

describe("the Strava revoke job (the outbox's other half)", () => {
  it("revokes upstream, then deletes the row", async () => {
    // The order is the guarantee: the row is what says we still owe Strava
    // a call, so it goes only after Strava confirms.
    const revoked: string[] = [];
    const revocationId = await seedRevocation("the-token");
    const deps = makeDeps({
      stravaApi: {
        deauthorize: (accessToken: string) => {
          revoked.push(accessToken);
          return Promise.resolve();
        },
      },
    });

    const { batch } = fakeBatch([
      { body: { type: "strava_revoke", revocationId } },
    ]);
    await handleImportsBatch(batch, deps);

    expect(revoked).toStrictEqual(["the-token"]);
    const rows = await coreDb()
      .select()
      .from(stravaRevocations)
      .where(eq(stravaRevocations.id, revocationId));
    expect(rows).toHaveLength(0);
  });

  it("keeps the row when the revoke fails, and retries the message", async () => {
    // A failure here must not lose the intent — the row is the only record
    // that we still owe Strava a call.
    const revocationId = await seedRevocation();
    const deps = makeDeps({
      stravaApi: {
        deauthorize: () => Promise.reject(new Error("Strava is down")),
      },
    });

    const { batch, wrapped } = fakeBatch([
      { body: { type: "strava_revoke", revocationId } },
    ]);
    await handleImportsBatch(batch, deps);

    expect(wrapped[0]?.wasRetried).toBe(true);
    const rows = await coreDb()
      .select()
      .from(stravaRevocations)
      .where(eq(stravaRevocations.id, revocationId));
    expect(rows).toHaveLength(1);
  });

  it("stops quietly when the row has already gone", async () => {
    // A duplicate delivery. The work is done; there is nothing to revoke.
    let called = 0;
    const deps = makeDeps({
      stravaApi: {
        deauthorize: () => {
          called += 1;
          return Promise.resolve();
        },
      },
    });

    const { batch, wrapped } = fakeBatch([
      { body: { type: "strava_revoke", revocationId: newUlid() } },
    ]);
    await handleImportsBatch(batch, deps);

    expect(called).toBe(0);
    expect(wrapped[0]?.wasAcked).toBe(true);
  });

  it("reports a revoke job with no credentials rather than retrying it", async () => {
    // Retrying cannot help: the deployment has no Strava secrets. The DLQ
    // is not the right home for that either — it is a configuration
    // problem a human has to see.
    const revocationId = await seedRevocation();
    const deps = makeDeps();

    const { batch, wrapped } = fakeBatch([
      { body: { type: "strava_revoke", revocationId } },
    ]);
    await handleImportsBatch(batch, deps);

    expect(wrapped[0]?.wasAcked).toBe(true);
    expect((deps.exceptions[0]?.error as Error).message).toBe(
      "strava revoke job with no api configured",
    );
    expect(deps.exceptions[0]?.context).toStrictEqual({
      surface: "strava-revoke",
    });
    const rows = await coreDb()
      .select()
      .from(stravaRevocations)
      .where(eq(stravaRevocations.id, revocationId));
    expect(rows).toHaveLength(1);
  });
});

describe("importFailureReason", () => {
  it("passes an Error's own sentence through", () => {
    // Every parser throws RunParseError, whose message is already the
    // sentence the runner reads.
    expect(importFailureReason(new RunParseError("tcx: no laps"))).toBe(
      PARSE_FAILURE_MESSAGE,
    );
    expect(importFailureReason(new Error("something specific"))).toBe(
      "something specific",
    );
  });

  it("falls back to the parse copy for anything that is not an Error", () => {
    // A library throwing a string is the case this exists for: the runner
    // still gets a sentence rather than "undefined".
    expect(importFailureReason("decoder exploded")).toBe(PARSE_FAILURE_MESSAGE);
    expect(importFailureReason(undefined)).toBe(PARSE_FAILURE_MESSAGE);
  });
});

describe("what the consumer tells the runner", () => {
  it("names the reason in the import-failed notification", async () => {
    // The reason is the parser's user-facing sentence, and it is the only
    // thing the runner has to act on.
    const db = coreDb();
    const userId = newUlid();
    const importId = await seedImport(db, userId, malformedTcx, "tcx");

    const { batch } = fakeBatch([{ body: { type: "import", importId } }]);
    await handleImportsBatch(batch, makeDeps());

    const [notification] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId));
    expect(notification?.kind).toBe("import_failed");
    expect(notification?.body).toMatch(/didn't work/);
    expect(notification?.body).toMatch(/didn't parse/);
  });

  it("asks for the kit on a run Strava says they logged, and says nothing about it", async () => {
    // D-33: the body carries no distance, pace or time, and the deep link
    // is /runs/new rather than a pre-created run. The sentence is pinned
    // because it is the whole notification.
    const db = coreDb();
    const athleteId = String(Date.now());
    const userId = await connectAthlete(db, athleteId);

    const { batch } = fakeBatch([
      { body: reminderJob({ athleteId, objectId: newUlid() }) },
    ]);
    await handleImportsBatch(batch, makeDeps({ db }));

    const [notification] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId));
    expect(notification?.kind).toBe("strava_reminder");
    expect(notification?.body).toBe("New run on Strava — log your kit?");
  });

  it("asks for the kit on a run it just imported", async () => {
    const db = coreDb();
    const userId = newUlid();
    const importId = await seedImport(db, userId, validTcx, "tcx");

    const { batch } = fakeBatch([{ body: { type: "import", importId } }]);
    await handleImportsBatch(batch, makeDeps());

    const [notification] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId));
    expect(notification?.kind).toBe("kit_reminder");
    expect(notification?.body).toMatch(/kit/i);
    const [after] = await db.select().from(imports).where(eq(imports.id, importId));
    expect(notification?.subjectId).toBe(after?.runId);
  });
});

describe("claim, then work", () => {
  it("marks the row processing before it opens the file", async () => {
    // Law 2, in order: the claim is what stops an overlapping invocation
    // double-processing, so it has to land before the work starts — and it
    // has to write the exact status the claim's own WHERE accepts, or a
    // consumer that dies mid-job leaves a row nothing can ever reclaim.
    const db = coreDb();
    const userId = newUlid();
    const importId = await seedImport(db, userId, validTcx, "tcx");
    const statusWhenOpened: (string | undefined)[] = [];

    const { batch } = fakeBatch([{ body: { type: "import", importId } }]);
    await handleImportsBatch(
      batch,
      makeDeps({
        db,
        importBucket: {
          get: async (key) => {
            const [row] = await db
              .select()
              .from(imports)
              .where(eq(imports.id, importId));
            statusWhenOpened.push(row?.status);
            return env.IMPORTS.get(key);
          },
        },
      }),
    );

    expect(statusWhenOpened).toStrictEqual(["processing"]);
  });


  it("reclaims a row left in processing by a consumer that died", async () => {
    // Law 2's other half: `processing` is claimable, because at-least-once
    // delivery is the recovery path for a worker that crashed mid-job.
    const db = coreDb();
    const userId = newUlid();
    const importId = await seedImport(db, userId, validTcx, "tcx");
    await db
      .update(imports)
      .set({ status: "processing" })
      .where(eq(imports.id, importId));

    const { batch } = fakeBatch([{ body: { type: "import", importId } }]);
    await handleImportsBatch(batch, makeDeps());

    const [after] = await db.select().from(imports).where(eq(imports.id, importId));
    expect(after?.status).toBe("done");
  });

  it("does not reclaim a row that already reached a conclusion", async () => {
    const db = coreDb();
    const userId = newUlid();
    const importId = await seedImport(db, userId, validTcx, "tcx");
    await db
      .update(imports)
      .set({ status: "duplicate" })
      .where(eq(imports.id, importId));

    const { batch } = fakeBatch([{ body: { type: "import", importId } }]);
    await handleImportsBatch(batch, makeDeps());

    const [after] = await db.select().from(imports).where(eq(imports.id, importId));
    expect(after?.status).toBe("duplicate");
    expect(after?.runId).toBeNull();
  });
});

describe("weather attachment is only attempted where it can help", () => {
  it("does not ask for conditions on an indoor run", async () => {
    // An indoor run's weather status is `none`, and there is nothing to
    // resolve — calling anyway is a wasted round trip on every treadmill
    // import.
    const db = coreDb();
    const userId = newUlid();
    const importId = await seedImport(db, userId, treadmillTcx, "tcx");
    const attached: string[] = [];

    const { batch } = fakeBatch([{ body: { type: "import", importId } }]);
    await handleImportsBatch(
      batch,
      makeDeps({
        attachObservation: (runId: string) => {
          attached.push(runId);
          return Promise.resolve();
        },
      }),
    );

    const [after] = await db.select().from(imports).where(eq(imports.id, importId));
    expect(after?.status).toBe("done");
    expect(attached).toStrictEqual([]);
  });

  it("asks for conditions on an outdoor run", async () => {
    const db = coreDb();
    const userId = newUlid();
    const importId = await seedImport(db, userId, validTcx, "tcx");
    const attached: string[] = [];

    const { batch } = fakeBatch([{ body: { type: "import", importId } }]);
    await handleImportsBatch(
      batch,
      makeDeps({
        attachObservation: (runId: string) => {
          attached.push(runId);
          return Promise.resolve();
        },
      }),
    );

    const [after] = await db.select().from(imports).where(eq(imports.id, importId));
    expect(attached).toStrictEqual([after?.runId]);
  });
});
