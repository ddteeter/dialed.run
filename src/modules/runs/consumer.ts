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
  stravaRevocations,
} from "../../db/schema-core";
import { newUlid } from "../../lib/ids";
import type { CoreDb } from "./core-db";
import { createNotification, notificationInsert } from "../notifications";
import { PARSE_FAILURE_MESSAGE, extensionFromKey, sourceFor } from "./parsers";
import {
  importsQueueMessageSchema,
  type ImportJob,
  type ReminderJob,
  type RevokeJob,
} from "./queue-messages";
import type { StravaApi } from "./strava/api";
import { findDuplicateRun, initialWeatherStatus } from "./service";

export interface ConsumerDeps {
  db: CoreDb;
  /**
  Narrowed to what the consumer uses, like `stravaApi` below: reading one
  stored file is the whole dependency, and a test can then hand it a stub
  without restating an R2 bucket.
  */
  importBucket: Pick<R2Bucket, "get">;
  captureException: (
    error: unknown,
    context: Record<string, string>,
  ) => void;
  /**
  Pending(102↔103): wire to weather.attachObservation once that module
  merges; degrades to a no-op (weather stays 'pending') until then.
  */
  attachObservation?: ((runId: string) => Promise<unknown>) | undefined;
  /**
  Present when Strava credentials are configured; the revoke job is a
  no-op without them.
  */
  stravaApi?: Pick<StravaApi, "deauthorize"> | undefined;
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

/**
 * The sentence the runner is shown when an import fails.
 *
 * Every parser throws `RunParseError`, whose message is already that
 * sentence, so the branch below is for the one case a parser cannot
 * promise: a library throwing something that is not an Error. Exported so
 * both halves are observable — the same shape as `reasonFrom` in
 * `modules/closet`.
 */
export function importFailureReason(error: unknown): string {
  return error instanceof Error ? error.message : PARSE_FAILURE_MESSAGE;
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
  // One gate, not two. There used to be a terminal-status check here as
  // well, reading `importRow.status` that the select above had already
  // fetched — but the claim's own `WHERE status IN ('pending',
  // 'processing')` refuses exactly the same rows, and it refuses them at
  // write time rather than from a value that may already be stale. A
  // redelivery of completed work claims nothing and stops here.
  const didClaim = await didClaimImport(deps.db, job.importId);
  if (!didClaim) return; // already concluded, or lost the race

  const object = await deps.importBucket.get(importRow.r2Key);
  if (object === null) {
    await failImport(deps.db, importRow, PARSE_FAILURE_MESSAGE);
    return;
  }

  let draft;
  try {
    const extension = extensionFromKey(importRow.r2Key);
    const bytes = await object.arrayBuffer();
    draft = await sourceFor(extension).parse(bytes);
  } catch (error) {
    await failImport(deps.db, importRow, importFailureReason(error));
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
  // Resolve the athlete first, then write both rows together.
  //
  // Claim-then-notify was two separate writes with a gap: if the claim
  // landed and the notification did not, the event was permanently marked
  // processed and the reminder was lost — redelivery would hit the claim
  // and return. Batching them closes that, and both writes are safe to
  // repeat anyway (INSERT OR IGNORE on the event key; the notification is
  // UNIQUE on user+kind+subject), which is what makes at-least-once
  // delivery harmless here.
  const [connected] = await deps.db
    .select({ userId: stravaConnections.userId })
    .from(stravaConnections)
    .where(eq(stravaConnections.athleteId, job.athleteId))
    .limit(1);

  const claim = deps.db
    .insert(processedWebhookEvents)
    .values({
      objectId: job.objectId,
      aspectType: job.aspectType,
      eventTime: job.eventTime,
    })
    .onConflictDoNothing();

  // An athlete nobody has connected: record the event so it is not
  // reconsidered, and stop.
  if (connected === undefined) {
    await claim;
    return;
  }

  await deps.db.batch([
    claim,
    // D-33: zero activity data in the body — deep link is /runs/new, not a
    // pre-created run.
    notificationInsert(deps.db, {
      userId: connected.userId,
      kind: "strava_reminder",
      subjectId: job.objectId,
      body: "New run on Strava — log your kit?",
    }),
  ]);
}

/**
 * Revoke a Strava grant the user has already been disconnected from.
 *
 * Idempotent by nature: revoking an already-revoked token is a no-op
 * upstream, and there is no local state left to reconcile. A failure here
 * throws so the queue retries; exhausting retries puts it in the DLQ,
 * which is where a grant we could not revoke should end up.
 */
async function processRevokeJob(
  deps: ConsumerDeps,
  job: RevokeJob,
): Promise<void> {
  if (deps.stravaApi === undefined) {
    deps.captureException(new Error("strava revoke job with no api configured"), {
      surface: "strava-revoke",
    });
    return; // no credentials: retrying will not help
  }

  // The outbox row is the source of truth; the message is only a pointer to
  // it. A duplicate delivery finds nothing and stops, and a lost one is
  // picked up by the digest.
  const [pending] = await deps.db
    .select()
    .from(stravaRevocations)
    .where(eq(stravaRevocations.id, job.revocationId))
    .limit(1);
  if (pending === undefined) return; // already revoked

  await deps.stravaApi.deauthorize(pending.accessToken);
  // Only after Strava confirms. A failure above throws, the queue retries,
  // and the row stays — which is the whole point of writing it down.
  await deps.db
    .delete(stravaRevocations)
    .where(eq(stravaRevocations.id, job.revocationId));
}

async function processJob(
  deps: ConsumerDeps,
  job: ImportJob | ReminderJob | RevokeJob,
): Promise<void> {
  switch (job.type) {
    case "import": {
      await processImportJob(deps, job);
      return;
    }
    case "strava_reminder": {
      await processReminderJob(deps, job);
      return;
    }
    case "strava_revoke": {
      await processRevokeJob(deps, job);
      return;
    }
  }
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
      await processJob(deps, parsed.data);
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
