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
import { z } from "zod";

import { emailPayloadSchema } from "../contracts/email";
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
 * (nothing, once the photo is removed or the garment deleted). The runner's
 * id is part of the payload because it is part of the prefix — a drain can
 * only ever touch that runner's own objects.
 */
const photoDelete = outboxKind("photo_delete", {
  userId: z.string().min(1),
  itemId: z.string().min(1),
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
 * Delete a run file on a date: a failed import's 30 days after it failed
 * (owner, 2026-10-04), and a read one's at once, in the batch that
 * concludes its import (D-116). Neither has a fast path; the daily drain
 * pays both. The same payload and the same prefix rule as
 * `import_file_delete`.
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
const email = z.object({
  kind: z.literal("email"),
  payload: z.object({
    dedupeKey: z.string().min(1),
    email: emailPayloadSchema,
    reminder: reminderEmailRefSchema.optional(),
  }),
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

export const outboxMessageSchema = z.discriminatedUnion("kind", [
  photoDelete,
  entryMediaDelete,
  importFileDelete,
  importFileExpire,
  email,
  productLink,
  manualConditionsDelete,
]);

export type OutboxMessage = z.infer<typeof outboxMessageSchema>;
export type OutboxKind = OutboxMessage["kind"];

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
];

/**
 * The debt's identity: a second enqueue of the same key is the same row.
 *
 * Per kind, because what makes two debts one differs. One `photo_delete`
 * per garment, because what it does — reconcile the garment's prefix
 * against its row — covers every version at once. One `entry_media_delete`
 * per entry, and one `*` for "every entry of this runner's". One
 * `import_file_delete` or `import_file_expire` per object. One
 * `product_link` per runner, because one run links all of their garments.
 * One `manual_conditions_delete` per run. An email's is its writer's to
 * name.
 */
export function dedupeKeyFor(message: OutboxMessage): string {
  switch (message.kind) {
    case "photo_delete": {
      return `${message.payload.userId}:${message.payload.itemId}`;
    }
    case "entry_media_delete": {
      return `${message.payload.userId}:${message.payload.entryId ?? "*"}`;
    }
    case "import_file_delete":
    case "import_file_expire": {
      return `${message.payload.userId}:${message.payload.key}`;
    }
    case "email": {
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
