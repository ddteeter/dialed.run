/**
 * The safety server functions' input contracts, kept out of `functions.ts`.
 *
 * That file imports `createServerFn`, so nothing in it can be imported by
 * a test or reached by mutation testing (R-41). A zod schema is a trust
 * boundary and belongs where it can be exercised, which is here.
 *
 * **Error copy lives in these messages**, not in the components. Both
 * sides run the same schema (`ui/use-form-submit`'s "one schema, run
 * twice"), so a sentence written here is the sentence the runner reads,
 * and a component authoring its own would be the rival truth one layer
 * down.
 */
import { z } from "zod";

import { takedownRequestSchema } from "../../lib/contracts/takedown";
import { rowIdSchema, ulidSchema } from "../../lib/ids";

import {
  closureRuleSchema,
  removalReasonSchema,
  declineReasonField,
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
  subjectId: rowIdSchema,
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
  userId: rowIdSchema,
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
 * A decision on a handle the re-ask flagged (D-97): **Keep** — the handle
 * is fine, and the flag clears — or **Rename**, the moderator's
 * force-rename with a reason from its fixed list, which O0's "USERNAME
 * CHANGED BY A MODERATOR" quotes to the runner. Never Remove.
 */
export const handleReviewInput = z.discriminatedUnion("action", [
  z.object({ queueId: ulidSchema, action: z.literal("keep") }),
  z.object({
    queueId: ulidSchema,
    action: z.literal("rename"),
    nameReason: renameReasonSchema,
  }),
]);

export type HandleReviewValues = z.infer<typeof handleReviewInput>;

/**
 * A copyright hold the Desk acts on (D-130, design 149): "Counter-notice
 * received" or "Court action filed", each naming only the hold.
 */
export const copyrightHoldInput = z.object({ holdId: ulidSchema });

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
  userId: rowIdSchema,
  // Not `reason`: D8 draws Rename beside Close account, whose field is
  // `reason`, and a field's name is its id.
  nameReason: renameReasonSchema,
});

/**
Reopening a closed account from D8.
*/
export const unbanUserInput = z.object({
  userId: rowIdSchema,
});

/**
The run whose removals its author's page shows (R-140). `runId` is bounded,
not a ULID: a malformed `/runs/abc` must reach the page's own not-found and
not fail here first. `since` is a kit page's own `createdAt`.
*/
export const runRemovalsInput = z.object({
  runId: rowIdSchema,
  since: z.number().int().nonnegative().optional(),
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
  userId: rowIdSchema,
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
  /**
   * The rule it breaks, which the notice names (C8, D-145), or suspected
   * CSAM, whose notice names none.
   */
  rule: closureRuleSchema,
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

/**
 * `/takedown`'s request (design 136): the shared form schema, and the
 * Turnstile answer riding beside it, as Au5's request carries one.
 */
export const takedownRequestInput = takedownRequestSchema.extend({
  turnstileToken: z.string().max(2048).optional(),
});

/**
 * An operator's decision on a request (design 136): remove it, or decline
 * it with the reason the requester is sent. Error copy lives here.
 */
const removalRequestRef = z.object({ requestId: ulidSchema });

/**
Block and decline all (design 137): the request whose requester it is.
*/
export const blockRequesterInput = removalRequestRef;

/**
 * Review's "Record the NCMEC report" (C12): which quarantine, and
 * CyberTipline's id for the report when the operator has it. The field
 * is optional, so an empty one means none; bounded and plain, because it
 * is copied from NCMEC's confirmation rather than written.
 */
export const ncmecReportInput = z.object({
  recordId: ulidSchema,
  reportId: z
    .string()
    .trim()
    .regex(
      /^[\w-]{0,40}$/u,
      "Paste the report number as NCMEC gave it: letters, digits and dashes, 40 at most.",
    )
    .optional()
    .transform((id) => (id === "" ? undefined : id)),
});

/**
 * A confirm link's token (design 137): 32 random bytes, hex. Anything
 * else is a link nobody sent.
 */
const confirmTokenSchema = z.string().regex(/^[\da-f]{64}$/u);

export const takedownConfirmInput = z.object({ token: confirmTokenSchema });

/**
`/takedown/confirm?token=`: the token when it is one, and nothing otherwise.
*/
export function takedownConfirmSearch(
  search: Readonly<Record<string, unknown>>,
): { token?: string | undefined } {
  const parsed = confirmTokenSchema.safeParse(search.token);
  return { token: parsed.success ? parsed.data : undefined };
}

export const removalDecisionInput = z.discriminatedUnion("outcome", [
  removalRequestRef.extend({ outcome: z.literal("removed") }),
  removalRequestRef.extend({
    outcome: z.literal("declined"),
    reason: declineReasonField,
  }),
]);
