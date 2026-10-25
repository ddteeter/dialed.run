/**
 * "Import from Garmin" (plan 152, phase 1; design G3): the owner's last
 * ten runs on Garmin, which of them are already here, and the import of
 * one. From the `.FIT` on, an import is an upload like any other.
 *
 * The download happens in the request, not on the queue: the runner is
 * waiting, a failure says so and they tap again (law 8c's "neither"), and
 * nothing is written until the file is in hand.
 */
import { and, eq, inArray, isNotNull } from "drizzle-orm";

import { imports } from "../../../db/schema-core";
import { firstColumnWhere } from "../../../lib/sql/keyed-read";
import type { CoreDb } from "../core-db";
import { startImport } from "../imports";
import type { ImportsQueueProducer, ReportException } from "../imports";
import { createGarminApi, GarminUnavailable } from "./api";
import type { GarminActivity } from "./api";
import type { GarminConfig } from "./config";

/**
G3: IMPORT FROM GARMIN · LAST 10.
*/
export const GARMIN_PICKER_SIZE = 10;

export interface GarminPickerRow extends GarminActivity {
  /**
  The run it became, when it is here: [IMPORTED] › opens it.
  */
  runId: string | undefined;
}

export type GarminPicker =
  { status: "ready"; rows: GarminPickerRow[] } | { status: "unreachable" };

export interface GarminDeps {
  db: CoreDb;
  /**
  Undefined unless this runner is the one the key is for.
  */
  config: GarminConfig | undefined;
  report: ReportException;
  fetchImpl?: typeof fetch;
}

function apiOf(config: GarminConfig, fetchImpl: typeof fetch | undefined) {
  return createGarminApi(config.apiKey, config.origin, fetchImpl);
}

/**
Any failure to hear from Garmin, told to Sentry. The reason names the step
and the status, never a token (law 7); anything that is not one of the
client's own refusals is a bug of ours, and says so.
*/
function reportUnavailable(
  deps: GarminDeps,
  error: unknown,
  userId: string,
  surface: string,
): void {
  const reason =
    error instanceof GarminUnavailable ? error.reason : "unexpected";
  deps.report(error, { surface, userId, reason });
}

/**
The picker, or nothing at all for anyone the feature is not for.
*/
export async function garminPicker(
  deps: GarminDeps,
  userId: string,
): Promise<GarminPicker | undefined> {
  if (deps.config === undefined) return undefined;
  let recent: GarminActivity[];
  try {
    recent = await apiOf(deps.config, deps.fetchImpl).recentRuns(
      GARMIN_PICKER_SIZE,
    );
  } catch (error) {
    reportUnavailable(deps, error, userId, "garmin-list");
    return { status: "unreachable" };
  }

  const ids = recent.map((activity) => activity.activityId);
  // An empty list is `false` to drizzle's `inArray`, so it reads no row.
  const imported = await deps.db
    .select({ activityId: imports.garminActivityId, runId: imports.runId })
    .from(imports)
    .where(
      and(
        eq(imports.userId, userId),
        inArray(imports.garminActivityId, ids),
        isNotNull(imports.runId),
      ),
    );
  const runOf = new Map(imported.map((row) => [row.activityId, row.runId]));
  return {
    status: "ready",
    rows: recent.map((activity) => ({
      ...activity,
      runId: runOf.get(activity.activityId) ?? undefined,
    })),
  };
}

function importOf(db: CoreDb, userId: string, activityId: string) {
  return firstColumnWhere(
    db,
    imports,
    imports.id,
    and(eq(imports.userId, userId), eq(imports.garminActivityId, activityId)),
  );
}

export interface GarminImportDeps extends GarminDeps {
  importBucket: R2Bucket;
  queue: ImportsQueueProducer;
}

export type GarminImport =
  { status: "started"; importId: string } | { status: "unreachable" };

/**
 * Imports one activity. One that is already here, or on its way, returns
 * its own import and fetches nothing: picked twice, or tapped twice, it
 * imports once. Two taps that race both download, and the UNIQUE index on
 * `(user_id, garmin_activity_id)` lets one insert win; the loser's file
 * goes with its failed insert (`startImport`), and it answers with the
 * winner's import.
 */
export async function importGarminActivity(
  deps: GarminImportDeps,
  userId: string,
  input: { activityId: string; idempotencyKey: string },
): Promise<GarminImport | undefined> {
  if (deps.config === undefined) return undefined;
  const existing = await importOf(deps.db, userId, input.activityId);
  if (existing !== undefined) return { status: "started", importId: existing };

  let bytes: ArrayBuffer;
  try {
    bytes = await apiOf(deps.config, deps.fetchImpl).fitFile(input.activityId);
  } catch (error) {
    reportUnavailable(deps, error, userId, "garmin-download");
    return { status: "unreachable" };
  }

  try {
    const { importId } = await startImport(
      deps.db,
      deps.importBucket,
      deps.queue,
      {
        userId,
        filename: `${input.activityId}.fit`,
        bytes,
        idempotencyKey: input.idempotencyKey,
        garminActivityId: input.activityId,
      },
      deps.report,
    );
    return { status: "started", importId };
  } catch (error) {
    const winner = await importOf(deps.db, userId, input.activityId);
    if (winner === undefined) throw error;
    return { status: "started", importId: winner };
  }
}
