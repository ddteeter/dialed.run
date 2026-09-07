/**
 * Messages on the dialed-imports queue (and its DLQ). Queue bodies are a
 * trust boundary: consumers parse with these schemas, never cast.
 */
import { z } from "zod";

const importJobSchema = z.object({
  type: z.literal("import"),
  importId: z.string().min(1),
});
export type ImportJob = z.infer<typeof importJobSchema>;

/**
Strava reminder (D-33): carries the recipient and a dedupe subject only —
never distance, pace, time, or any other activity attribute.
*/
/**
Carries the *athlete* id, not a userId: the webhook enqueues before it
knows which user this is, so that the HTTP response does not wait on a
database round trip. Resolving athlete -> user is the consumer's job, and
so is the dedupe.
*/
const reminderJobSchema = z.object({
  type: z.literal("strava_reminder"),
  athleteId: z.string().min(1),
  objectId: z.string().min(1),
  aspectType: z.string().min(1),
  eventTime: z.number().int(),
});
export type ReminderJob = z.infer<typeof reminderJobSchema>;

/**
Revoking a Strava grant after the user has already been disconnected
locally. Carries the access token because that is all `deauthorize` needs
and the row it came from is already gone.

The token is a secret on a queue, which is a trade-off worth naming: it is
single-purpose (the only thing anyone can do with it is the revocation we
are asking for), it is about to be invalid by construction, and the DLQ
path reports only the message id, never the body. The alternative — holding
the row until the revoke succeeds — means a user who asked to disconnect is
still connected while an upstream call retries, which is worse.
*/
const revokeJobSchema = z.object({
  type: z.literal("strava_revoke"),
  accessToken: z.string().min(1),
});
export type RevokeJob = z.infer<typeof revokeJobSchema>;

export const importsQueueMessageSchema = z.discriminatedUnion("type", [
  importJobSchema,
  reminderJobSchema,
  revokeJobSchema,
]);
