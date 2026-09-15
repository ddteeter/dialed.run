/**
 * The `screening-retry` sweep: re-drive photos still marked `pending`.
 *
 * This is the reconciliation half of law 8c. R2 holds the bytes and D1
 * holds the verdict, and nothing is transactional across the two — so
 * rather than an outbox, the photo's own `pending` status is the durable
 * marker that says "not finished", and this re-runs anything wearing it.
 * A screening interrupted anywhere heals on the next firing.
 *
 * It also covers the case that is not a failure at all: every photo
 * uploaded while `OPENAI_API_KEY` was unset is `pending`, and the first
 * firing after the key exists screens the backlog.
 */
import { env } from "../../env";

import type { Classify } from "./screening";
import {
  pendingEntryPhotos,
  pendingGarmentPhotos,
  screenPhoto,
  type PendingPhoto,
} from "./screening";

export interface RetryReport {
  considered: number;
  passed: number;
  flagged: number;
  /** Still pending afterwards — the classifier declined or the bytes were
   * unreadable. Not an error: the next firing tries again. */
  deferred: number;
}

/**
 * Screens one bounded batch of pending photos.
 *
 * **Returns a report rather than throwing**, because the caller is a cron
 * handler whose job is to put anomalies in the digest, not to fail. A
 * sweep that dies on the third of fifty photos has done less work than one
 * that records three failures and screens the other forty-seven.
 */
export async function retryPendingScreenings(
  classify: Classify | undefined,
  anomalies: string[],
): Promise<RetryReport> {
  const pending = [
    ...(await pendingEntryPhotos()),
    ...(await pendingGarmentPhotos()),
  ];

  const report: RetryReport = {
    considered: pending.length,
    passed: 0,
    flagged: 0,
    deferred: 0,
  };

  if (classify === undefined) {
    // No key configured. Every pending photo stays pending and their
    // owners keep seeing them; what would be wrong is screening them with
    // something that guesses. Said once, not once per photo.
    if (pending.length > 0) {
      anomalies.push(
        `${String(pending.length)} photos await screening; OPENAI_API_KEY is not set`,
      );
    }
    report.deferred = pending.length;
    return report;
  }

  for (const photo of pending) {
    const outcome = await screenOne(photo, classify);
    if (outcome === "pass") report.passed += 1;
    else if (outcome === "flagged") report.flagged += 1;
    else report.deferred += 1;
  }

  if (report.deferred > 0) {
    anomalies.push(
      `${String(report.deferred)} of ${String(report.considered)} photos still pending after a screening sweep`,
    );
  }
  return report;
}

/**
 * Fetches the bytes and screens one photo.
 *
 * A missing R2 object defers rather than throwing or resolving. It is the
 * one case where "try again forever" is arguably wrong — the object may
 * never arrive — but a photo that stays invisible to the public is a safe
 * resting place, and guessing that it is gone would mean publishing bytes
 * nobody classified.
 */
async function screenOne(
  photo: PendingPhoto,
  classify: Classify,
): Promise<"pass" | "flagged" | "deferred"> {
  const object = await env.MEDIA.get(photo.photoKey);
  if (!object) return "deferred";
  const bytes = new Uint8Array(await object.arrayBuffer());
  return screenPhoto(
    {
      scope: photo.scope,
      photoId: photo.photoId,
      bytes,
      // R2 keeps what was uploaded; the upload path already refused
      // anything that is not one of the three allowed types.
      contentType: object.httpMetadata?.contentType ?? "image/jpeg",
    },
    classify,
  );
}
