import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { stravaConnections, imports, runs } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { coreDb } from "../../src/modules/runs/core-db";
import {
  handleImportsBatch,
  handleImportsDlqBatch,
} from "../../src/modules/runs/consumer";
import type { ConsumerDeps } from "../../src/modules/runs/consumer";
import { createManualRun } from "../../src/modules/runs/service";
import { unreadNotificationCount } from "../../src/modules/notifications";
import validTcx from "./fixtures/valid.tcx?raw";
import malformedTcx from "./fixtures/malformed.tcx?raw";

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
    expect(await unreadNotificationCount(deps.db, userId)).toBe(1);
    expect(deps.exceptions.length).toBeGreaterThan(0);
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
