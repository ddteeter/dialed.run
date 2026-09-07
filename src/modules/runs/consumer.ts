/**
 * `dialed-imports` queue consumer + its DLQ handler (102 §4, §8). Every
 * queue body is parsed with `importsQueueMessageSchema` (trust boundary),
 * and every message is acked or retried individually so one bad message
 * never blocks the rest of the batch.
 *
 * Idempotency (resilience law 1) lives in the `imports` row's `status`:
 * a redelivered ImportJob for an already-terminal import (`done` / `failed`
 * / `duplicate`) is a silent no-op. Weather attach is dependency-injected
 * (`attachObservation`) so this compiles and tests fully without lane 103
 * — see the pending-integration call-site below.
 */
import { and, eq, inArray } from "drizzle-orm";

import {
  imports,
  processedWebhookEvents,
  runs,
  stravaConnections,
} from "../../db/schema-core";
import { newUlid } from "../../lib/ids";
import type { CoreDb } from "./core-db";
import { createNotification } from "./notifications";
import { extensionFromKey, sourceFor } from "./parsers";
import {
  importsQueueMessageSchema,
  type ImportJob,
  type ReminderJob,
} from "./queue-messages";
import { findDuplicateRun, initialWeatherStatus } from "./service";

export interface ConsumerDeps {
  db: CoreDb;
  importBucket: R2Bucket;
  captureException: (
    error: unknown,
    context: Record<string, string>,
  ) => void;
  /**
  Pending(102↔103): wire to weather.attachObservation once that module
  merges; degrades to a no-op (weather stays 'pending') until then.
  */
  attachObservation?: ((runId: string) => Promise<void>) | undefined;
}

const IMPORT_TERMINAL_STATUSES = ["done", "failed", "duplicate"] as const;

async function didClaimImport(
  db: CoreDb,
  importId: string,
): Promise<boolean> {
  const result = await db
    .update(imports)
    .set({ status: "processing" })
    .where(
      and(
        eq(imports.id, importId),
        inArray(imports.status, ["pending", "processing"]),
      ),
    );
  return result.meta.changes > 0;
}

async function failImport(
  db: CoreDb,
  importRow: { id: string; userId: string },
  reason: string,
): Promise<void> {
  await db
    .update(imports)
    .set({ status: "failed", failureReason: reason })
    .where(eq(imports.id, importRow.id));
  await createNotification(db, {
    userId: importRow.userId,
    kind: "import_failed",
    subjectId: importRow.id,
    body: `Your run import didn't work: ${reason}`,
  });
}

async function processImportJob(
  deps: ConsumerDeps,
  job: ImportJob,
): Promise<void> {
  const rows = await deps.db
    .select()
    .from(imports)
    .where(eq(imports.id, job.importId))
    .limit(1);
  const importRow = rows[0];
  if (importRow === undefined) {
    // Nothing to do — the row is gone (shouldn't happen; log and move on).
    deps.captureException(new Error("import row missing for queue job"), {
      importId: job.importId,
    });
    return;
  }
  if (
    (IMPORT_TERMINAL_STATUSES as readonly string[]).includes(
      importRow.status,
    )
  ) {
    return; // redelivery of already-completed work — idempotent no-op
  }
  const didClaim = await didClaimImport(deps.db, job.importId);
  if (!didClaim) return; // lost the race to another invocation, or terminal

  const object = await deps.importBucket.get(importRow.r2Key);
  if (object === null) {
    await failImport(
      deps.db,
      importRow,
      "That file didn't parse. Try the original export from your watch.",
    );
    return;
  }

  let draft;
  try {
    const extension = extensionFromKey(importRow.r2Key);
    const bytes = await object.arrayBuffer();
    draft = await sourceFor(extension).parse(bytes);
  } catch (error) {
    const reason =
      error instanceof Error
        ? error.message
        : "That file didn't parse. Try the original export from your watch.";
    await failImport(deps.db, importRow, reason);
    return;
  }

  const duplicate = await findDuplicateRun(
    deps.db,
    importRow.userId,
    draft.startedAt,
  );
  if (duplicate !== undefined) {
    await deps.db
      .update(imports)
      .set({ status: "duplicate", runId: duplicate.id })
      .where(eq(imports.id, importRow.id));
    return;
  }

  const weatherStatus = initialWeatherStatus(draft);
  const runId = newUlid();
  await deps.db.insert(runs).values({
    id: runId,
    userId: importRow.userId,
    source: "file",
    startedAt: draft.startedAt,
    durationS: draft.durationS,
    distanceM: draft.distanceM,
    lat: draft.indoor ? undefined : draft.lat,
    lng: draft.indoor ? undefined : draft.lng,
    indoor: draft.indoor,
    title: draft.title,
    weatherStatus,
  });

  if (weatherStatus === "pending" && deps.attachObservation) {
    try {
      await deps.attachObservation(runId);
    } catch (error) {
      // Degrade, don't fail (law 5) — the run stays 'pending' for the
      // weather module's own retry machinery once it exists.
      deps.captureException(error, { runId, surface: "attachObservation" });
    }
  }

  await deps.db
    .update(imports)
    .set({ status: "done", runId })
    .where(eq(imports.id, importRow.id));

  await createNotification(deps.db, {
    userId: importRow.userId,
    kind: "kit_reminder",
    subjectId: runId,
    body: "Add your kit for the run you just imported.",
  });
}

/**
 * The work the webhook used to do before it could reply. Doing it here
 * costs nothing extra: the consumer has to be idempotent regardless,
 * because queue delivery is at-least-once.
 */
async function processReminderJob(
  deps: ConsumerDeps,
  job: ReminderJob,
): Promise<void> {
  // Claim the event first. INSERT OR IGNORE on the (object, aspect, time)
  // key, and proceed only if this delivery is the one that inserted it —
  // so a redelivered message, or the same event sent twice by Strava,
  // notifies once.
  const claim = await deps.db
    .insert(processedWebhookEvents)
    .values({
      objectId: job.objectId,
      aspectType: job.aspectType,
      eventTime: job.eventTime,
    })
    .onConflictDoNothing();
  if (claim.meta.changes === 0) return;

  const [connected] = await deps.db
    .select({ userId: stravaConnections.userId })
    .from(stravaConnections)
    .where(eq(stravaConnections.athleteId, job.athleteId))
    .limit(1);
  if (connected === undefined) return; // unknown or disconnected athlete

  // D-33: zero activity data in the body — deep link is /runs/new, not a
  // pre-created run.
  await createNotification(deps.db, {
    userId: connected.userId,
    kind: "strava_reminder",
    subjectId: job.objectId,
    body: "New run on Strava — log your kit?",
  });
}

export async function handleImportsBatch(
  batch: MessageBatch,
  deps: ConsumerDeps,
): Promise<void> {
  for (const message of batch.messages) {
    const parsed = importsQueueMessageSchema.safeParse(message.body);
    if (!parsed.success) {
      deps.captureException(new Error("invalid imports queue message"), {
        queue: batch.queue,
        messageId: message.id,
      });
      message.ack(); // never retry structurally-invalid garbage
      continue;
    }
    try {
      if (parsed.data.type === "import") {
        await processImportJob(deps, parsed.data);
      } else {
        await processReminderJob(deps, parsed.data);
      }
      message.ack();
    } catch (error) {
      deps.captureException(error, {
        queue: batch.queue,
        messageId: message.id,
      });
      message.retry();
    }
  }
}

/**
DLQ ownership (102 §8): a dead-lettered ImportJob marks the import `failed`
with a user-facing reason and notifies the user — no import ends in
silence. A dead-lettered ReminderJob has no user-visible entity to mark, so
it only reports to Sentry.
*/
export async function handleImportsDlqBatch(
  batch: MessageBatch,
  deps: ConsumerDeps,
): Promise<void> {
  for (const message of batch.messages) {
    const parsed = importsQueueMessageSchema.safeParse(message.body);
    if (parsed.success && parsed.data.type === "import") {
      const rows = await deps.db
        .select()
        .from(imports)
        .where(eq(imports.id, parsed.data.importId))
        .limit(1);
      const importRow = rows[0];
      if (
        importRow !== undefined &&
        !(IMPORT_TERMINAL_STATUSES as readonly string[]).includes(
          importRow.status,
        )
      ) {
        await failImport(
          deps.db,
          importRow,
          "We couldn't process this import after several tries. Try uploading it again.",
        );
      }
    }
    deps.captureException(new Error("dead-lettered dialed-imports message"), {
      queue: batch.queue,
      messageId: message.id,
    });
    message.ack();
  }
}
