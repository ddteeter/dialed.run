/**
 * A photo still pending screening a day after upload goes to a person
 * (D-157, design 167).
 *
 * The `screening-retry` sweep re-drives every `pending` photo, and most of
 * them heal there. Two never do: a photo whose object is not in storage,
 * and one the classifier will not answer for. Both used to wait forever —
 * hidden from everyone but their owner, who saw "being checked" with no
 * end — and the only trace was an hourly line with no ids (law 6). Past
 * the day, each becomes a review queue row, so the Desk owns it.
 */
import { lt } from "drizzle-orm";

import { reviewQueue } from "../../db/schema-core";
import { coreDb } from "../../env";

import { enqueueForReview } from "./review";
import { queueSubjectOf, type PhotoScope } from "./screening";

/**
How long a photo may wait on screening before a person is asked: a day.
*/
export const STUCK_AFTER_SECONDS = 24 * 60 * 60;

export interface StuckPhoto {
  scope: PhotoScope;
  photoId: string;
  /**
  Whether storage had no object for it, rather than no answer.
  */
  missing: boolean;
}

/**
 * Whether a photo uploaded at `uploadedAt` has waited the day out by
 * `now`. At exactly a day it has. A photo whose upload time cannot be read
 * (a key this app did not mint) is taken as old: the cost of asking a
 * person too early is one look, and of never asking, a photo that waits
 * forever.
 */
export function isStuck(uploadedAt: number | undefined, now: number): boolean {
  return (uploadedAt ?? 0) <= now - STUCK_AFTER_SECONDS;
}

/**
 * Puts stuck photos in front of a person, in one batch, and says how many
 * it opened.
 *
 * **Idempotent in SQL, because the sweep re-runs every hour (laws 1, 2).**
 * Each write is the queue's upsert on `UNIQUE(subject_type, subject_id)`,
 * so a photo is never two rows. It opens a new row, or re-opens one that
 * was settled more than a day ago, and does nothing else:
 *
 * - **an open row is left alone** — a reviewer is already on it, whatever
 *   brought it there; an open row has no `resolved_at`, and `lt` on NULL is
 *   false, which is the whole of that check;
 * - **a row a person settled within the day stays settled**, so the hourly
 *   sweep does not put back what someone just decided. A photo still
 *   pending a day after the decision comes back once a day, not every hour.
 *
 * `RETURNING` reports only the rows actually written, so what comes back
 * is what this firing did, not what it attempted.
 */
export async function escalateStuck(
  stuck: readonly StuckPhoto[],
  now: number,
): Promise<StuckPhoto[]> {
  const database = coreDb();
  const [first, ...rest] = stuck.map((photo) =>
    enqueueForReview(
      database,
      {
        subjectType: queueSubjectOf[photo.scope],
        subjectId: photo.photoId,
        source: photo.missing ? "missing_file" : "unscreened",
      },
      lt(reviewQueue.resolvedAt, now - STUCK_AFTER_SECONDS),
    ).returning({ subjectId: reviewQueue.subjectId }),
  );
  if (first === undefined) return [];
  const written = await database.batch([first, ...rest]);
  const opened = new Set(written.flat().map((row) => row.subjectId));
  return stuck.filter((photo) => opened.has(photo.photoId));
}
