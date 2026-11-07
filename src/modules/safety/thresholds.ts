/**
 * The moderation thresholds, read from config rather than source (owner,
 * 2026-11-06): the `MODERATION_THRESHOLDS` secret, JSON parsed through
 * zod like anything else from outside. Its value lives with the deploy
 * checklist, not in this repo; the tests run on invented values of their
 * own (`test/wrangler.test.jsonc`).
 *
 * **Absent or malformed, moderation fails closed.** Every report reason
 * hides on its first report, and screening does not run, so a new photo
 * stays `pending`, seen by its owner and nobody else, as it is with no
 * classifier at all; the hourly sweep screens the backlog once the
 * secret is right. The same sweep tells Sentry for as long as it is not.
 */
import { z } from "zod";

import { env } from "../../env";
import { imageCategories } from "./classifier/moderation";
import type { CategoryScores } from "./classifier/moderation";
import { reportReasonSchema } from "./contracts";
import type { ReportReason } from "./contracts";

/**
 * The config's shape: how many distinct reporters each reason needs before
 * a subject is hidden from everyone, and each image category's score at
 * which a photo is held. Every reason and every category, and nothing
 * else: a config that forgets one is malformed, not partly right.
 */
export const moderationThresholdsSchema = z.strictObject({
  reports: z.record(reportReasonSchema, z.int().min(1)),
  photos: z.record(z.enum(imageCategories), z.number().gt(0).max(1)),
});

export type ModerationThresholds = z.infer<typeof moderationThresholdsSchema>;

/**
 * The config, parsed, or `undefined` for anything that is not it: unset,
 * empty, not JSON, or the wrong shape.
 */
export function parseThresholds(
  raw: unknown,
): ModerationThresholds | undefined {
  if (typeof raw !== "string" || raw === "") return undefined;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }
  return moderationThresholdsSchema.safeParse(json).data;
}

/**
 * The thresholds this Worker runs on, from its environment.
 */
export function moderationThresholds(): ModerationThresholds | undefined {
  return parseThresholds(env.MODERATION_THRESHOLDS);
}

/**
 * Distinct reporters a reason needs before its subject is hidden; one,
 * failing closed, when the config is missing.
 */
export function reportersToHide(
  reason: ReportReason,
  thresholds: ModerationThresholds | undefined,
): number {
  return thresholds?.reports[reason] ?? 1;
}

/**
 * The fewest reporters any reason in `reasons` needs: the reconcile
 * sweep's bar for a subject over it by count. One, failing closed.
 */
export function fewestReportersToHide(
  reasons: readonly ReportReason[],
  thresholds: ModerationThresholds | undefined,
): number {
  return Math.min(
    ...reasons.map((reason) => reportersToHide(reason, thresholds)),
  );
}

/**
 * Each category's hold score, or `undefined` when the config is missing,
 * in which case screening does not run.
 */
export function photoThresholds(
  thresholds: ModerationThresholds | undefined,
): CategoryScores | undefined {
  return thresholds?.photos;
}

/**
 * The hourly sweep's line while the config is missing or malformed, and
 * nothing once it is right.
 */
export function thresholdsAnomaly(
  thresholds: ModerationThresholds | undefined,
): string | undefined {
  return thresholds === undefined
    ? "MODERATION_THRESHOLDS is unset or malformed: every report hides at once and photo screening is paused"
    : undefined;
}
