/**
 * The safety server functions' input contracts, kept out of `functions.ts`.
 *
 * That file imports `createServerFn`, so nothing in it can be imported by
 * a test or reached by mutation testing (D-41). A zod schema is a trust
 * boundary and belongs where it can be exercised, which is here.
 *
 * **Error copy lives in these messages**, not in the components. Both
 * sides run the same schema (`ui/use-form-submit`'s "one schema, run
 * twice"), so a sentence written here is the sentence the runner reads,
 * and a component authoring its own would be the rival truth one layer
 * down.
 */
import { z } from "zod";

import { ulidSchema } from "../../lib/ids";

import {
  removalReasonSchema,
  renameReasonSchema,
  reportReasonSchema,
  reportSubjectTypeSchema,
} from "./contracts";

/**
 * Free text on a report. Optional by design — W1's own copy is "One or two
 * lines is plenty", and a required box would turn a thirty-second action
 * into a writing task most people abandon.
 *
 * Capped because it is UGC that a person will read: long enough for the
 * context a reporter actually has, short enough that the review page shows
 * a report rather than an essay.
 */
const reportNoteSchema = z
  .string()
  .trim()
  .max(500, "Keep it under 500 characters — a line or two is plenty.")
  .optional();

export const fileReportInput = z.object({
  subjectType: reportSubjectTypeSchema,
  /**
   * Not a ULID: a product id is one, but a report can name a profile, and
   * user ids come from Better Auth rather than from `newUlid`. Bounded
   * instead, since the only thing downstream does with it is match a row.
   */
  subjectId: z.string().min(1).max(64),
  reason: reportReasonSchema,
  note: reportNoteSchema,
  /**
   * W1's "Block them as well" checkbox. Part of the report rather than a
   * second call, because a reporter who ticked it and lost the second
   * request would be told the report worked while the block silently did
   * not.
   */
  alsoBlock: z.boolean().optional(),
});
export type FileReportValues = z.infer<typeof fileReportInput>;

export const blockRunnerInput = z.object({
  userId: z.string().min(1).max(64),
});

export const reviewDecisionInput = z.object({
  queueId: ulidSchema,
  decision: z.enum(["approve", "remove"]),
});

/**
 * A review decision that can take content down (task 128 · SAF-5): the
 * reason is the statement the author is sent, and `quarantine` is the
 * suspected-CSAM Remove, which keeps one copy out of every route's reach.
 */
export const reviewActionInput = z.discriminatedUnion("action", [
  z.object({ queueId: ulidSchema, action: z.literal("approve") }),
  z.object({
    queueId: ulidSchema,
    action: z.literal("remove"),
    reason: removalReasonSchema,
  }),
  z.object({
    queueId: ulidSchema,
    action: z.literal("quarantine"),
    reason: removalReasonSchema,
  }),
]);

export type ReviewActionValues = z.infer<typeof reviewActionInput>;

/**
 * A copyright takedown from the Desk (SAF-6): a named photo or entry, and
 * the notice it answers — kept on the audit row, "who, what and why".
 */
export const takedownInput = z.object({
  subjectType: z.enum(["entry", "photo"], {
    message: "Pick a photo or an entry.",
  }),
  subjectId: ulidSchema,
  notice: z
    .string()
    .trim()
    .min(1, "Say who sent the notice and its reference.")
    .max(500, "Keep it under 500 characters."),
});

/**
A moderator's force-rename (round 27 #16).
*/
export const forceRenameInput = z.object({
  userId: z.string().min(1).max(64),
  reason: renameReasonSchema,
});

/**
Reopening a closed account from D8.
*/
export const unbanUserInput = z.object({
  userId: z.string().min(1).max(64),
});

/**
 * D8's search and filter (round 27 #22). Both optional: the page opens on
 * everyone.
 */
export const runnersFilterInput = z.object({
  query: z.string().trim().max(254).optional(),
  filter: z.enum(["all", "reported", "closed"]).default("all"),
});

export const banUserInput = z.object({
  userId: z.string().min(1).max(64),
  /**
   * Required, unlike a report's note. A ban is the heaviest thing this app
   * does to a person and the notice quotes this back to them, so "no
   * reason given" is not an acceptable state for it to be in.
   */
  reason: z
    .string()
    .trim()
    .min(1, "Say why — the ban notice quotes this back to them.")
    .max(500, "Keep it under 500 characters."),
});

export const denyDomainInput = z.object({
  domain: z
    .string()
    .trim()
    .min(1, "Enter a domain.")
    .max(253, "That is longer than any real domain.")
    // Deliberately loose: the review flow pastes whatever it has, and
    // `domainOf` normalises a full URL or a bare host to the same stored
    // value. A strict pattern here would reject the URL a reviewer is
    // most likely to have in their clipboard.
    .refine((value) => !value.includes(" "), "A domain has no spaces in it."),
  reason: z.string().trim().max(500).optional(),
});
