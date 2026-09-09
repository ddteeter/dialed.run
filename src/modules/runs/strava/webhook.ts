/**
 * Strava reminder webhook (102 §6, D-14/D-33). The subscription handshake
 * and every event body are trust boundaries: the GET challenge is checked
 * against the configured verify token, and the POST envelope is zod-parsed
 * before anything touches the database. Compliance rule (non-negotiable):
 * the notification carries zero activity data — no distance, pace, or
 * time from Strava, ever. This module never reads or stores anything
 * beyond the athlete id (to find the connected user) and the dedupe key.
 */
import { z } from "zod";

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
  // Unconfigured or blank, in one check: `searchParams.get` returns a
  // string or null and can never equal undefined, so an explicit
  // `=== undefined` arm would be unreachable — but it can equal "", which
  // would make a blank deployment secret match every caller.
  if (!verifyToken) return undefined;
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

  // Enqueue and return. Strava disables a subscription that does not answer
  // promptly, and this used to do two D1 round trips first — a connection
  // lookup and a dedupe insert — before it could respond. Neither needs to
  // happen here: the consumer has to be idempotent anyway, because queue
  // redelivery is at-least-once, so doing the dedupe there costs nothing
  // and removes it from the response path.
  //
  // Nothing about the activity travels with the message beyond its id and
  // timestamp, which are the dedupe key (D-33: zero activity data).
  await queue.send({
    type: "strava_reminder",
    athleteId: String(event.owner_id),
    objectId: String(event.object_id),
    aspectType: event.aspect_type,
    eventTime: event.event_time,
  });
}
