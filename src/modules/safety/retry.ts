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
import type { ScreenOutcome } from "./screening";
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
    // Counted through a lookup rather than an if/else-if/else. The `else`
    // swallowed every outcome that was not one of the first two, so the
    // word "deferred" itself was never checked by anything — a sweep
    // returning nonsense counted it as deferred and looked correct.
    report[countedAs[await screenOne(photo, classify)]] += 1;
  }

  if (report.deferred > 0) {
    anomalies.push(
      `${String(report.deferred)} of ${String(report.considered)} photos still pending after a screening sweep`,
    );
  }
  return report;
}

/**
Which tally each outcome lands in.
*/
const countedAs = {
  pass: "passed",
  // The middle band is a pass as far as the runner is concerned — the
  // photo is live — so it is counted with the passes rather than given a
  // tally of its own. What makes it visible to an operator is the review
  // queue row it wrote, which is where the decision actually lives.
  review: "passed",
  flagged: "flagged",
  deferred: "deferred",
} as const;

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
): Promise<ScreenOutcome> {
  const object = await env.MEDIA.get(photo.photoKey);
  if (!object) return "deferred";
  const bytes = new Uint8Array(await object.arrayBuffer());
  return screenPhoto(
    {
      scope: photo.scope,
      photoId: photo.photoId,
      bytes,
      contentType: contentTypeOf(object),
    },
    classify,
  );
}

/**
 * The content type R2 stored, or jpeg.
 *
 * R2 keeps what was uploaded and the upload path already refused anything
 * that is not one of the three allowed types, so the fallback is for
 * objects older than that path — or for an `httpMetadata` the runtime
 * types as optional and in practice always supplies. Named rather than
 * inlined because that second case is unreachable through `env.MEDIA` and
 * so untestable there, while the rule itself is worth stating once: a
 * classifier asked about "undefined" rejects the request outright.
 */
export function contentTypeOf(object: {
  httpMetadata?: { contentType?: string };
}): string {
  return object.httpMetadata?.contentType ?? "image/jpeg";
}
