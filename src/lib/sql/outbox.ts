/**
 * The outbox's wire format (law 9): what a row's `kind` and `payload` may
 * say, parsed on the way out rather than trusted.
 *
 * A row is written by one deploy and drained by another — possibly an
 * older one after a rollback — so the rules are a queue message's: add a
 * kind, never repurpose one; a new payload field is optional; a kind stops
 * being written before it stops being read.
 *
 * **A payload never carries a secret.** It is JSON in a shared table, and
 * the drainer reports failures with context read from it. Anything a kind
 * needs that is sensitive stays where it lives and is looked up by id.
 */
import type { drizzle } from "drizzle-orm/d1";
import { z } from "zod";

import { emailPayloadSchema, type EmailPayload } from "../contracts/email";
import { importFilePrefix } from "../import-file-key";

/**
One kind's wire shape: its literal `kind` and the fields of its payload.
*/
function outboxKind<K extends string, S extends z.ZodRawShape>(
  kind: K,
  payload: S,
) {
  return z.object({ kind: z.literal(kind), payload: z.object(payload) });
}

/**
 * Clear what a garment's photo prefix holds beyond the photo its row names
 * (nothing, once the photo is removed or the garment deleted) — or, with no
 * `itemId`, every garment prefix a runner has, which is the shape account
 * deletion asks for. The runner's id is part of the payload because it is
 * part of the prefix — a drain can only ever touch that runner's own
 * objects.
 */
const photoDelete = outboxKind("photo_delete", {
  userId: z.string().min(1),
  itemId: z.string().min(1).optional(),
});

/**
 * Clear what an entry's photo prefix holds beyond the photos its rows
 * still name (task 128 · SAF-3): an entry deleted, one photo deleted, or —
 * with no `entryId` — every entry a runner ever posted, which is the shape
 * account deletion asks for. Reconciled against the rows rather than
 * naming keys, for the garment kind's reason: the rows that named them are
 * deleted in the same batch that owes this.
 */
const entryMediaDelete = z.object({
  kind: z.literal("entry_media_delete"),
  payload: z.object({
    userId: z.string().min(1),
    entryId: z.string().min(1).optional(),
  }),
});

/**
 * Delete one run-file upload (a GPX or FIT track, which carries the route a
 * runner ran from their door) once its run is deleted. The key is named
 * because nothing else will: the `imports` row that held it goes in the
 * same batch. It must sit under the runner's own prefix, so a drain can
 * only ever reach their objects.
 */
const importFileKey = z
  .object({
    userId: z.string().min(1),
    key: z.string().min(1),
  })
  .refine((payload) =>
    payload.key.startsWith(importFilePrefix(payload.userId)),
  );

const importFileDelete = z.object({
  kind: z.literal("import_file_delete"),
  payload: importFileKey,
});

/**
 * Delete a failed import's run file 30 days after it failed (owner,
 * 2026-10-04). It has no fast path; the daily drain pays it. The same
 * payload and the same prefix rule as `import_file_delete`, which is how
 * a read file goes (D-116): owed in the batch that concludes its import
 * and paid straight after it.
 *
 * Its own kind rather than a held `import_file_delete`, because the drain
 * reads the two differently: a due `import_file_delete` is a fast path
 * that failed, which the digest reports, where a due `import_file_expire`
 * is the schedule arriving, which it does not (`scheduledOutboxKinds`).
 */
const importFileExpire = z.object({
  kind: z.literal("import_file_expire"),
  payload: importFileKey,
});

/**
 * Which Strava reminder an owed email is (design 140): the runner, when
 * the reminder that owed it landed — its bell row's `created_at` — and the
 * runner's calendar day. A second reminder that day takes the row over and
 * leaves this as it was, so the email stands for every reminder from that
 * landing on, not for one bell row.
 */
const reminderEmailRefSchema = z.object({
  userId: z.string().min(1),
  landedAt: z.number().int(),
  day: z.string().min(1),
});

export type ReminderEmailRef = z.infer<typeof reminderEmailRefSchema>;

/**
 * An email owed (task 126, ACC-2): anything secondary to the write that
 * owes it — an invite, a notice, the run reminder — so the event and the
 * intent to tell someone about it commit together (law 8c) and the drain
 * retries a send that failed.
 *
 * `dedupeKey` is the caller's name for "the same email": a second debt
 * with it is the same row, and **the first payload stays**. The second
 * takes the row over (ops' `outboxInsert`: the id and when it is due) and
 * never rewrites what it says. That is what makes two of a runner's
 * reminders landing at once safe: both owe the day's key, one row is
 * written, and one email goes, saying what the first one owed. A row can
 * be held back (ops' `oweOutbox`
 * `notBefore`) — task 127's reminder goes out 20 minutes after the run
 * lands — and a held row is left to the drain, never a fast path.
 *
 * `reminder` marks task 127's Strava reminder (design 140): the runner,
 * when the reminder that owed it landed, and the runner's day it is that
 * day's email for. Checked when it is due — no reminder from that landing
 * on still unread (an upload pairs and reads its own), the runner no
 * longer connected, or the day's email already sent, and nothing goes —
 * and the day is marked sent in the batch that marks the row sent. Optional, so a row an earlier deploy wrote still
 * parses (law 9).
 */
const emailFields = {
  dedupeKey: z.string().min(1),
  email: z.unknown().transform((value, context): EmailPayload => {
    // A fresh build on every row, never this union's own copy (design
    // 283): the email schemas are built on use, so their mutants are not
    // static. It accepts and returns what `emailPayloadSchema()` does.
    const parsed = emailPayloadSchema().safeParse(value);
    if (!parsed.success) {
      // One issue that carries the payload schema's own message: any issue
      // fails the row, and `readOutboxRow` reports none of them.
      context.addIssue(parsed.error.message);
      return z.NEVER;
    }
    return parsed.data;
  }),
};

const email = z.object({
  kind: z.literal("email"),
  payload: z.object({
    ...emailFields,
    reminder: reminderEmailRefSchema.optional(),
  }),
});

/**
 * An email to the operators (design 232): a removal's 48-hour alert, its
 * 40-hour reminder, a removal request's alert, the takedown valve's.
 * Its own kind so that its own cap is drained first, ahead of every other
 * email, and nothing a visitor can cause to be mailed waits in front of
 * it. Sent as `email` is; scheduled, since no fast path sends it.
 */
const operatorEmail = z.object({
  kind: z.literal("operator_email"),
  payload: z.object(emailFields),
});

/**
 * Link a newly confirmed runner's typed garments to the shared products
 * (design 133, decision D-113 Q1). An unconfirmed runner's garments save
 * with no product; the confirmation owes this in its own batch, so the
 * debt lands exactly when the address is confirmed. No fast path works
 * it — the link is `closet`'s, which the confirmation's module cannot
 * import — so the hourly drain does, with the Worker entry's wiring.
 */
const productLink = z.object({
  kind: z.literal("product_link"),
  payload: z.object({ userId: z.string().min(1) }),
});

/**
 * Delete a deleted run's band (C1): its `manual_conditions` row, which is
 * in `DIALED_WEATHER`, so no batch that deletes the run can reach it (law
 * 8c). The run's delete owes this in its own batch, and only for a run
 * that was the runner's — the run id is the whole of what it deletes, so
 * the writer is what keeps it to the runner's own. The runner's id rides
 * along for the report a failure files, nothing else.
 */
const manualConditionsDelete = outboxKind("manual_conditions_delete", {
  userId: z.string().min(1),
  runId: z.string().min(1),
});

const outboxMessageSchema = z.discriminatedUnion("kind", [
  photoDelete,
  entryMediaDelete,
  importFileDelete,
  importFileExpire,
  // Before `email`: the daily drain works kinds in this order.
  operatorEmail,
  email,
  productLink,
  manualConditionsDelete,
]);

export type OutboxMessage = z.infer<typeof outboxMessageSchema>;
export type OutboxKind = OutboxMessage["kind"];
/**
One kind's message: what that kind's debt carries, and its handler reads.
*/
export type OutboxMessageOf<K extends OutboxKind> = Extract<
  OutboxMessage,
  { kind: K }
>;

/**
Every kind this build can drain, read from the union rather than listed.
*/
export const outboxKinds: readonly OutboxKind[] =
  outboxMessageSchema.options.map((option) => option.shape.kind.value);

/**
 * Kinds whose rows are owed on a date rather than by a failure: no fast
 * path ever works them, so a row the drain finds due is the schedule, not
 * a debt someone failed to pay. The drain settles them without a digest
 * line; one that does not settle is reported like any other.
 */
export const scheduledOutboxKinds: readonly OutboxKind[] = [
  "import_file_expire",
  // Never a fast path's (D-113 Q1): the drain is the only worker it has.
  "product_link",
  // Never a fast path's either (design 232): due at once, for the next drain.
  "operator_email",
];

/**
 * The debt's identity: a second enqueue of the same key is the same row.
 *
 * Per kind, because what makes two debts one differs. One `photo_delete`
 * per garment, because what it does — reconcile the garment's prefix
 * against its row — covers every version at once, and one `*` for "every
 * garment of this runner's". One `entry_media_delete`
 * per entry, and one `*` for "every entry of this runner's". One
 * `import_file_delete` or `import_file_expire` per object. One
 * `product_link` per runner, because one run links all of their garments.
 * One `manual_conditions_delete` per run. An email's, an operator's
 * included, is its writer's to name.
 */
export function dedupeKeyFor(message: OutboxMessage): string {
  switch (message.kind) {
    case "photo_delete": {
      return `${message.payload.userId}:${message.payload.itemId ?? "*"}`;
    }
    case "entry_media_delete": {
      return `${message.payload.userId}:${message.payload.entryId ?? "*"}`;
    }
    case "import_file_delete":
    case "import_file_expire": {
      return `${message.payload.userId}:${message.payload.key}`;
    }
    case "email":
    case "operator_email": {
      return message.payload.dedupeKey;
    }
    case "product_link": {
      return message.payload.userId;
    }
    case "manual_conditions_delete": {
      return `${message.payload.userId}:${message.payload.runId}`;
    }
  }
}

/**
 * A stored row read back: the message, or what is wrong with it. The two
 * failures are named apart because they point at different culprits — a
 * payload that is not JSON was written wrong, a well-formed one that fails
 * the union is a kind or shape this build does not know (law 9's rollback
 * case).
 */
export type ReadOutboxRow =
  | { readonly ok: true; readonly message: OutboxMessage }
  | { readonly ok: false; readonly problem: string };

/**
 * Never throws: a row that cannot be read is surfaced by the caller, not
 * allowed to take the drain down with it.
 */
export function readOutboxRow(kind: string, payload: string): ReadOutboxRow {
  let decoded: unknown;
  try {
    decoded = JSON.parse(payload);
  } catch {
    return { ok: false, problem: "payload is not JSON" };
  }
  const parsed = outboxMessageSchema.safeParse({ kind, payload: decoded });
  return parsed.success
    ? { ok: true, message: parsed.data }
    : { ok: false, problem: "not a kind and payload this build knows" };
}

/**
 * An email owed to an operator, as an outbox message (design 232): the
 * `operator_email` kind, drained ahead of every other email. `dedupeKey`
 * names "the same email", as `email`'s does.
 */
export function operatorEmailMessage(
  email: EmailPayload,
  dedupeKey: string,
): OutboxMessageOf<"operator_email"> {
  return { kind: "operator_email", payload: { dedupeKey, email } };
}

/**
 * What a handler's work is handed: the binding's drizzle handle.
 */
type Db = ReturnType<typeof drizzle>;

/**
 * One kind's payload, as its handler receives it.
 */
export type PayloadOf<K extends OutboxKind> = OutboxMessageOf<K>["payload"];

/**
 * Declared here, beside the kinds, rather than with the drain in
 * `ops/outbox` (design 261, B12): a handler lives with what it touches
 * (design 256), so a module that only writes one (weather's manual
 * conditions) takes the type from `lib` and never imports `ops`.
 */
/**
 * Every kind's handler: what a drain is handed. A mapped type, compared
 * by shape, so one handler can serve two kinds whose payloads it fits
 * (the email handler, for `email` and `operator_email`).
 */
export type OutboxHandlers = {
  readonly [K in OutboxKind]: {
    /**
     * Does the work; throws when it could not, and the row stays owed.
     * `rowId` is the row being worked, for a handler that must mark it
     * before the delete (an email, once sent). `OWED_AGAIN` (ops/outbox) says the work is
     * done in part and the rest is owed to the next drain (design 232): the
     * row stays, with its attempts back at none, since nothing failed.
     * A `Refused` (ops/outbox) says the far side will not take this row's work.
     */
    readonly run: (
      db: Db,
      payload: PayloadOf<K>,
      rowId: string,
    ) => Promise<unknown>;
    /**
    Sentry context for a failure (law 7): ids to act on, never secrets.
    */
    readonly context: (payload: PayloadOf<K>) => Record<string, string>;
  };
};

/**
One kind's handler.
*/
export type OutboxHandler<K extends OutboxKind> = OutboxHandlers[K];
