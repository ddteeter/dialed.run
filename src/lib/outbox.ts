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

export const outboxMessageSchema = z.discriminatedUnion("kind", [photoDelete]);

export type OutboxMessage = z.infer<typeof outboxMessageSchema>;
export type OutboxKind = OutboxMessage["kind"];

/**
Every kind this build can drain, read from the union rather than listed.
*/
export const outboxKinds: readonly OutboxKind[] =
  outboxMessageSchema.options.map((option) => option.shape.kind.value);

/**
 * The debt's identity: a second enqueue of the same key is the same row.
 * One `photo_delete` per garment, because what it does — reconcile the
 * garment's prefix against its row — covers every version at once.
 */
export function dedupeKeyFor(message: OutboxMessage): string {
  return `${message.payload.userId}:${message.payload.itemId}`;
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
