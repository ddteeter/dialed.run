/**
 * Strava reminder webhook (102 §6, D-14/D-33). The subscription handshake
 * and every event body are trust boundaries: the GET challenge is checked
 * against the configured verify token, and the POST envelope is zod-parsed
 * before anything touches the database. Compliance rule (non-negotiable):
 * the notification carries zero activity data — no distance, pace, or
 * time from Strava, ever. This module never reads or stores anything
 * beyond the athlete id (to find the connected user) and the dedupe key.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";

import { processedWebhookEvents, stravaConnections } from "../../../db/schema-core";
import type { CoreDb } from "../core-db";
import type { ReminderJob } from "../queue-messages";

export interface ReminderQueueProducer {
  send(message: ReminderJob): Promise<unknown>;
}

const webhookEventSchema = z.object({
  object_type: z.enum(["activity", "athlete"]),
  object_id: z.number(),
  aspect_type: z.enum(["create", "update", "delete"]),
  owner_id: z.number(),
  subscription_id: z.number(),
  event_time: z.number(),
});

/**
GET subscription validation: Strava requires the exact `hub.challenge`
value echoed back once `hub.mode` and `hub.verify_token` check out.
Returns undefined for anything that doesn't validate (caller responds
403 — this is the one Strava exchange that isn't "always 200", since it's
the initial handshake, not an event delivery).
*/
export function verifyStravaChallenge(
  searchParams: URLSearchParams,
  verifyToken: string | undefined,
): { challenge: string } | undefined {
  if (verifyToken === undefined || verifyToken === "") return undefined;
  if (searchParams.get("hub.mode") !== "subscribe") return undefined;
  if (searchParams.get("hub.verify_token") !== verifyToken) return undefined;
  const challenge = searchParams.get("hub.challenge");
  if (challenge === null || challenge === "") return undefined;
  return { challenge };
}

/**
POST event handler. Always resolves (never throws) so the route can
respond 200 within 2s regardless of payload shape or dedupe outcome —
Strava disables webhooks that don't get a fast 200.
*/
export async function handleStravaWebhookEvent(
  db: CoreDb,
  queue: ReminderQueueProducer,
  captureException: (error: unknown, context: Record<string, string>) => void,
  body: unknown,
): Promise<void> {
  const parsed = webhookEventSchema.safeParse(body);
  if (!parsed.success) {
    captureException(new Error("invalid strava webhook payload"), {
      surface: "strava-webhook",
    });
    return;
  }
  const event = parsed.data;
  if (event.object_type !== "activity" || event.aspect_type !== "create") {
    return; // only a new activity is a "log your kit?" moment
  }

  const athleteId = String(event.owner_id);
  const connected = await db
    .select({ userId: stravaConnections.userId })
    .from(stravaConnections)
    .where(eq(stravaConnections.athleteId, athleteId))
    .limit(1);
  const userId = connected[0]?.userId;
  if (userId === undefined) return; // unknown/unconnected athlete -> no-op

  const subjectId = String(event.object_id);
  const inserted = await db
    .insert(processedWebhookEvents)
    .values({
      objectId: subjectId,
      aspectType: event.aspect_type,
      eventTime: event.event_time,
    })
    .onConflictDoNothing();
  if (inserted.meta.changes === 0) return; // already processed — no-op

  await queue.send({ type: "strava_reminder", userId, subjectId });
}
