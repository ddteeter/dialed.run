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
import { eq } from "drizzle-orm";

import {
  imports,
  processedWebhookEvents,
  runs,
  stravaConnections,
  stravaRevocations,
} from "../../db/schema-core";
import { didClaim } from "../../lib/claim";
import { newUlid } from "../../lib/ids";
import { firstRowWhere } from "../../lib/keyed-read";
import { consumeEach, deadLetterEach } from "../../lib/queue-batch";
import type { CoreDb } from "./core-db";
import { createNotification, notificationInsert } from "../notifications";
import { PARSE_FAILURE_MESSAGE, extensionFromKey, sourceFor } from "./parsers";
import {
  importsQueueMessageSchema,
  type DeauthorizeJob,
  type ImportJob,
  type ReminderJob,
  type RevokeJob,
} from "./queue-messages";
import type { StoredToken, StravaApi } from "./strava/api";
import { deauthorizeAthlete } from "./strava/deauthorize";
import {
  clearMatchingReminder,
  hasMatchingUpload,
} from "./strava/reminder-match";
import { findDuplicateRun, initialWeatherStatus, storedStart } from "./service";

export interface ConsumerDeps {
  db: CoreDb;
  /**
  Narrowed to what the consumer uses, like `stravaApi` below: reading one
  stored file is the whole dependency, and a test can then hand it a stub
  without restating an R2 bucket.
  */
  importBucket: Pick<R2Bucket, "get">;
  captureException: (error: unknown, context: Record<string, string>) => void;
  /**
  Pending(102↔103): wire to weather.attachObservation once that module
  merges; degrades to a no-op (weather stays 'pending') until then.
  */
  attachObservation?: ((runId: string) => Promise<unknown>) | undefined;
  /**
  Present when Strava credentials are configured; the revoke job is a
  no-op without them.
  */
  stravaApi?: Pick<StravaApi, "revoke"> | undefined;
}

const IMPORT_TERMINAL_STATUSES = ["done", "failed", "duplicate"] as const;

async function didClaimImport(db: CoreDb, importId: string): Promise<boolean> {
  return await didClaim(
    db,
    imports,
    { id: imports.id, status: imports.status },
    importId,
    ["pending", "processing"],
    { status: "processing" },
  );
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

/**
The import a job points at, or nothing when the row is gone.
*/
function importById(db: CoreDb, importId: string) {
  return firstRowWhere(db, imports, eq(imports.id, importId));
}

async function processImportJob(
  deps: ConsumerDeps,
  job: ImportJob,
): Promise<void> {
  const importRow = await importById(deps.db, job.importId);
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
    ...storedStart(draft),
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

  // The import is done, and the Strava reminder this file answers — if it
  // had one — is answered (round 25). One batch: both record the same
  // fact, that this run is now in the log.
  await deps.db.batch([
    deps.db
      .update(imports)
      .set({ status: "done", runId })
      .where(eq(imports.id, importRow.id)),
    clearMatchingReminder(
      deps.db,
      importRow.userId,
      draft.startedAt + draft.durationS,
    ),
  ]);

  await createNotification(deps.db, {
    userId: importRow.userId,
    kind: "kit_reminder",
    subjectId: runId,
    body: "Add your kit for the run you just imported.",
  });
}

/**
 * The S1 row a run landing on Strava leaves (round 25, "Strava reminds.
 * You upload."). Timed by when the run landed, which is the row's own
 * time; it names nothing about the run, because we know nothing about it.
 */
const STRAVA_REMINDER_BODY =
  "New run on Strava · Add it here: upload the file, then what you wore";

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

  // An athlete nobody has connected, or a run whose file is already in the
  // log (round 25: one reminder per run): record the event so it is not
  // reconsidered, and stop.
  if (
    connected === undefined ||
    (await hasMatchingUpload(deps.db, connected.userId, job.eventTime))
  ) {
    await claim;
    return;
  }

  await deps.db.batch([
    claim,
    // D-33: zero activity data in the body — no distance, no time, no
    // name. Round 25's words: Strava tells us a run happened, we remind,
    // the runner adds the file.
    notificationInsert(deps.db, {
      userId: connected.userId,
      kind: "strava_reminder",
      subjectId: job.objectId,
      body: STRAVA_REMINDER_BODY,
    }),
  ]);
}

/**
 * The token a revocation is made with: the refresh token (STR-2), which
 * does not expire, or — for a row written before that column existed —
 * the access token it copied, which is the best there is.
 */
function revocationToken(row: {
  accessToken: string;
  refreshToken: string | null;
}): StoredToken {
  return row.refreshToken === null
    ? { token: row.accessToken, kind: "access_token" }
    : { token: row.refreshToken, kind: "refresh_token" };
}

/**
 * Revoke a Strava grant the user has already been disconnected from.
 *
 * Idempotent by nature: Strava answers 200 to a revoke "whether or not the
 * token was found", so a grant already dead settles the row exactly as a
 * live one does, and there is no local state left to reconcile. A failure here
 * throws so the queue retries; exhausting retries puts it in the DLQ,
 * which is where a grant we could not revoke should end up.
 */
async function processRevokeJob(
  deps: ConsumerDeps,
  job: RevokeJob,
): Promise<void> {
  if (deps.stravaApi === undefined) {
    deps.captureException(
      new Error("strava revoke job with no api configured"),
      {
        surface: "strava-revoke",
      },
    );
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

  await deps.stravaApi.revoke(revocationToken(pending));
  // Only after Strava confirms. A failure above throws, the queue retries,
  // and the row stays — which is the whole point of writing it down.
  await deps.db
    .delete(stravaRevocations)
    .where(eq(stravaRevocations.id, job.revocationId));
}

async function processJob(
  deps: ConsumerDeps,
  job: ImportJob | ReminderJob | RevokeJob | DeauthorizeJob,
): Promise<void> {
  switch (job.type) {
    case "strava_deauthorize": {
      await deauthorizeAthlete(deps.db, job.athleteId, job.eventTime);
      return;
    }
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
  await consumeEach(batch, importsQueueMessageSchema, {
    process: (job) => processJob(deps, job),
    invalidMessage: "invalid imports queue message",
    captureException: deps.captureException,
  });
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
  await deadLetterEach(batch, importsQueueMessageSchema, {
    onJob: async (job) => {
      if (job.type !== "import") return;
      const importRow = await importById(deps.db, job.importId);
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
    },
    deadLettered: "dead-lettered dialed-imports message",
    captureException: deps.captureException,
  });
}
