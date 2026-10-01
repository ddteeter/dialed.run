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

import { emailPayloadSchema } from "./email";
import { importFilePrefix } from "./import-file-key";

/**
 * Clear what a garment's photo prefix holds beyond the photo its row names
 * (nothing, once the photo is removed or the garment deleted). The runner's
 * id is part of the payload because it is part of the prefix — a drain can
 * only ever touch that runner's own objects.
 */
const photoDelete = z.object({
  kind: z.literal("photo_delete"),
  payload: z.object({
    userId: z.string().min(1),
    itemId: z.string().min(1),
  }),
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
const importFileDelete = z.object({
  kind: z.literal("import_file_delete"),
  payload: z
    .object({
      userId: z.string().min(1),
      key: z.string().min(1),
    })
    .refine((payload) =>
      payload.key.startsWith(importFilePrefix(payload.userId)),
    ),
});

/**
 * An email owed (task 126, ACC-2): anything secondary to the write that
 * owes it — an invite, a notice, the run reminder — so the event and the
 * intent to tell someone about it commit together (law 8c) and the drain
 * retries a send that failed.
 *
 * `dedupeKey` is the caller's name for "the same email": a second debt
 * with it is the same row. A row can be held back (ops' `oweOutbox`
 * `notBefore`) — task 127's reminder goes out 20 minutes after the run
 * lands — and a held row is left to the drain, never a fast path.
 */
const email = z.object({
  kind: z.literal("email"),
  payload: z.object({
    dedupeKey: z.string().min(1),
    email: emailPayloadSchema,
  }),
});

export const outboxMessageSchema = z.discriminatedUnion("kind", [
  photoDelete,
  entryMediaDelete,
  importFileDelete,
  email,
]);

export type OutboxMessage = z.infer<typeof outboxMessageSchema>;
export type OutboxKind = OutboxMessage["kind"];

/**
Every kind this build can drain, read from the union rather than listed.
*/
export const outboxKinds: readonly OutboxKind[] =
  outboxMessageSchema.options.map((option) => option.shape.kind.value);

/**
 * The debt's identity: a second enqueue of the same key is the same row.
 *
 * Per kind, because what makes two debts one differs. One `photo_delete`
 * per garment, because what it does — reconcile the garment's prefix
 * against its row — covers every version at once. One `entry_media_delete`
 * per entry, and one `*` for "every entry of this runner's". One
 * `import_file_delete` per object. An email's is its writer's to name.
 */
export function dedupeKeyFor(message: OutboxMessage): string {
  switch (message.kind) {
    case "photo_delete": {
      return `${message.payload.userId}:${message.payload.itemId}`;
    }
    case "entry_media_delete": {
      return `${message.payload.userId}:${message.payload.entryId ?? "*"}`;
    }
    case "import_file_delete": {
      return `${message.payload.userId}:${message.payload.key}`;
    }
    case "email": {
      return message.payload.dedupeKey;
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
