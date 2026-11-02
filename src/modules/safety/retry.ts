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
 *
 * And the case that never heals by itself (D-157, design 167): a photo
 * still pending a day after upload goes to the Desk (`stuck.ts`).
 */
import { env } from "../../env";
import { nowSeconds } from "../../lib/now";

import type { Classify } from "./screening";
import type { ScreenOutcome } from "./screening";
import {
  pendingEntryPhotos,
  pendingGarmentPhotos,
  queueSubjectOf,
  screenPhoto,
  type PendingPhoto,
} from "./screening";
import { escalateStuck, isStuck, type StuckPhoto } from "./stuck";

export interface RetryReport {
  considered: number;
  passed: number;
  flagged: number;
  /** Still pending afterwards — the classifier declined or the bytes were
   * unreadable. Not an error: the next firing tries again. */
  deferred: number;
  /**
   * Of those, the ones a day old or more that this firing put in front of
   * a person (D-157) — rows it opened, not rows it found already open.
   */
  escalated: number;
}

/**
 * Screens one bounded batch of pending photos, and sends those still
 * pending a day after upload to the Desk.
 *
 * **Returns a report rather than throwing**, because the caller is a cron
 * handler whose job is to put anomalies in the digest, not to fail. A
 * sweep that dies on the third of fifty photos has done less work than one
 * that records three failures and screens the other forty-seven.
 */
export async function retryPendingScreenings(
  classify: Classify | undefined,
  anomalies: string[],
  now: number = nowSeconds(),
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
    escalated: 0,
  };

  if (classify === undefined && pending.length > 0) {
    // No key configured. Every pending photo stays pending and their
    // owners keep seeing them; what would be wrong is screening them with
    // something that guesses. Said once, not once per photo.
    anomalies.push(
      `${String(pending.length)} photos await screening; OPENAI_API_KEY is not set`,
    );
  }

  const unfinished: (StuckPhoto & { uploadedAt: number | undefined })[] = [];
  for (const photo of pending) {
    const outcome = await screenOne(photo, classify);
    // Counted through a lookup rather than an if/else-if/else. The `else`
    // swallowed every outcome that was not one of the first two, so the
    // word "deferred" itself was never checked by anything — a sweep
    // returning nonsense counted it as deferred and looked correct.
    report[countedAs[outcome]] += 1;
    const missing = missingWhen[outcome];
    if (missing !== undefined) {
      unfinished.push({
        scope: photo.scope,
        photoId: photo.photoId,
        missing,
        uploadedAt: photo.uploadedAt,
      });
    }
  }

  // With no key the line above already says why; naming every photo it
  // holds back would bury the digest in the backlog of a setting.
  if (classify !== undefined && unfinished.length > 0) {
    anomalies.push(
      `${String(report.deferred)} of ${String(report.considered)} photos still pending after a screening sweep: ${namesOf(unfinished)}`,
    );
  }

  const escalated = await escalateStuck(
    unfinished.filter((photo) => isStuck(photo.uploadedAt, now)),
    now,
  );
  report.escalated = escalated.length;
  if (escalated.length > 0) {
    anomalies.push(
      `${String(escalated.length)} photos still pending a day after upload went to the Desk: ${namesOf(escalated)}`,
    );
  }
  return report;
}

/**
 * Which photos a line is about, as an operator can look them up: the queue
 * subject and its id, and `(missing)` where storage had no object (law 7:
 * ids only — never a storage key, which names a runner, nor any bytes).
 */
function namesOf(photos: readonly StuckPhoto[]): string {
  return photos
    .map(
      (photo) =>
        `${queueSubjectOf[photo.scope]} ${photo.photoId}${photo.missing ? " (missing)" : ""}`,
    )
    .join(", ");
}

/**
 * What one attempt came to: a screening outcome, or `missing` when storage
 * had no object to screen — the one that never heals by retrying.
 */
type Attempt = ScreenOutcome | "missing";

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
  missing: "deferred",
} as const satisfies Record<Attempt, keyof RetryReport>;

/**
 * Whether an outcome leaves the photo pending, and if so whether its file
 * was missing; nothing for a photo that now has a verdict.
 */
const missingWhen: Record<Attempt, boolean | undefined> = {
  pass: undefined,
  review: undefined,
  flagged: undefined,
  deferred: false,
  missing: true,
};

/**
 * Fetches the bytes and screens one photo.
 *
 * A missing R2 object is `missing` rather than a throw or a verdict. The
 * sweep keeps trying it — the object may yet arrive — and a photo that
 * stays invisible to the public is a safe resting place, where guessing it
 * is gone would mean publishing bytes nobody classified. What changed with
 * D-157 is that it no longer rests there unwatched: a day on, it is a Desk
 * row that says the file is missing.
 *
 * With no classifier there is nothing to screen, but whether the object is
 * there is still worth knowing, so the object is still fetched and
 * `screenPhoto` answers `deferred` for want of a classifier. A `head`
 * first would save reading the bytes, in a state that lasts only until the
 * key is set — and was a branch no test could tell from this one.
 */
async function screenOne(
  photo: PendingPhoto,
  classify: Classify | undefined,
): Promise<Attempt> {
  const object = await env.MEDIA.get(photo.objectKey);
  if (!object) return "missing";
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
