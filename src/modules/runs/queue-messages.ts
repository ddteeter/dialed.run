/**
 * Messages on the dialed-imports queue (and its DLQ). Queue bodies are a
 * trust boundary: consumers parse with these schemas, never cast.
 */
import { z } from "zod";

/**
Every job on this queue is `{ type: <literal>, ...its own fields }` wrapped
the same way for `discriminatedUnion` to dispatch on. That wrapping is the
one thing every variant shares and should keep sharing (law 9: a new
variant is additive, never a reshape of an old one) — each variant's own
fields stay written out at its own call site, with its own comment.
*/
function jobSchema<Type extends string, Shape extends z.ZodRawShape>(
  type: Type,
  shape: Shape,
) {
  return z.object({ type: z.literal(type), ...shape });
}

/**
Each variant is one `jobSchema(...)` call in this array, with its reason
beside it. The only thing that differs between variants is the literal and
its fields, and the array says exactly that.
*/
export const importsQueueMessageSchema = z.discriminatedUnion("type", [
  // A run file uploaded through the import flow (102 §4).
  jobSchema("import", {
    importId: z.string().min(1),
  }),

  // Strava reminder (D-33): carries the recipient and a dedupe subject
  // only — never distance, pace, time, or any other activity attribute.
  // Carries the *athlete* id, not a userId: the webhook enqueues before it
  // knows which user this is, so that the HTTP response does not wait on
  // a database round trip. Resolving athlete -> user is the consumer's
  // job, and so is the dedupe.
  jobSchema("strava_reminder", {
    athleteId: z.string().min(1),
    objectId: z.string().min(1),
    aspectType: z.string().min(1),
    eventTime: z.number().int(),
  }),

  // Revoking a Strava grant after the user has already been disconnected
  // locally. Carries only the outbox row id: the token lives in
  // `strava_revocations`, written in the same batch as the disconnect, so
  // the message is a pointer to durable state rather than the secret
  // itself.
  //
  // That also means a lost or duplicated message costs nothing — the row
  // is the source of truth, the consumer deletes it on success, and the
  // digest re-dispatches anything still sitting there.
  jobSchema("strava_revoke", {
    revocationId: z.string().min(1),
  }),

  // A runner revoked dialed.run on Strava's side (STR-3). Like the
  // reminder, it carries the athlete id rather than a user id, so the
  // webhook answers without a database round trip; the event time keys
  // the S1 row, so a redelivery writes nothing twice. Added as a new
  // variant (law 9) — no existing message changed shape.
  jobSchema("strava_deauthorize", {
    athleteId: z.string().min(1),
    eventTime: z.number().int(),
  }),
]);

/**
Every variant's exported type is derived from the union rather than
restated per call site (CLAUDE.md, "derive, don't mirror") — the union
built above is already the one place each shape is written down.
*/
type ImportsQueueMessage = z.infer<typeof importsQueueMessageSchema>;
export type ImportJob = Extract<ImportsQueueMessage, { type: "import" }>;
export type ReminderJob = Extract<
  ImportsQueueMessage,
  { type: "strava_reminder" }
>;
export type RevokeJob = Extract<ImportsQueueMessage, { type: "strava_revoke" }>;
export type DeauthorizeJob = Extract<
  ImportsQueueMessage,
  { type: "strava_deauthorize" }
>;
