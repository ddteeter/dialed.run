/**
 * Strava reminder webhook (102 §6, D-14/D-33). The subscription handshake
 * and every event body are trust boundaries: the GET challenge is checked
 * against the configured verify token, and the POST envelope is zod-parsed
 * before anything touches the database. Compliance rule (non-negotiable):
 * the notification carries zero activity data — no distance, pace, or
 * time from Strava, ever. This module never reads or stores anything
 * beyond the athlete id (to find the connected user) and the dedupe key.
 */
import { timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { nowSeconds } from "../../../lib/now";
import type { DeauthorizeJob, ReminderJob } from "../queue-messages";

export interface ReminderQueueProducer {
  send(message: ReminderJob | DeauthorizeJob): Promise<unknown>;
}

/**
 * `updates.authorized` as a deauthorization carries it (see below).
 */
const deauthorizedSchema = z.union([z.literal("false"), z.literal(false)]);

const webhookEventSchema = z.object({
  object_type: z.enum(["activity", "athlete"]),
  object_id: z.number(),
  aspect_type: z.enum(["create", "update", "delete"]),
  owner_id: z.number(),
  subscription_id: z.number(),
  // Whole seconds, as the queue's job schema and the dedupe table take it.
  event_time: z.number().int(),
  // Only `authorized` is read, and only from an athlete event (STR-3).
  // Strava's docs write it as the string "false" and their example as the
  // boolean, so both are accepted. For an activity event `updates` holds
  // the title, type and privacy — activity data — and a zod object strips
  // every key it does not name, so none of that survives the parse.
  updates: z.object({ authorized: deauthorizedSchema.optional() }).optional(),
});

type WebhookEvent = z.infer<typeof webhookEventSchema>;

/**
 * The one field read before anything else: which subscription an event
 * claims to belong to.
 */
const subscriptionSchema = z.object({ subscription_id: z.number() });

/**
 * A runner revoking dialed.run from Strava's side: an athlete event whose
 * `updates.authorized` is false. Strava's API Policy §7.4 gives us thirty
 * days to delete what we hold; the consumer does it at once.
 */
function isDeauthorization(event: WebhookEvent): boolean {
  return (
    event.object_type === "athlete" && event.updates?.authorized !== undefined
  );
}

/**
 * How far ahead of our clock an event's `event_time` may be. Strava stamps
 * an event when it happens, so anything later than this is not one of its
 * events, and a stored time beyond the prune's cutoff would never age out
 * (`prune.ts`). A day leaves room for any clock skew.
 */
export const MAX_EVENT_AHEAD_SECONDS = 86_400;

/**
 * SA-M6: the webhook answers only at `/api/strava/<key>`, where the key is
 * `STRAVA_WEBHOOK_PATH_SECRET` and the subscription was registered with
 * that URL. Unset or blank accepts nothing, as an unset verify token
 * refuses the handshake. Compared in constant time; a different length is
 * refused before the comparison, which tells a caller only the length.
 */
export function isStravaCallbackKey(
  presented: string,
  expected: string | undefined,
): boolean {
  if (expected === undefined || expected === "") return false;
  const encoder = new TextEncoder();
  const theirs = encoder.encode(presented);
  const ours = encoder.encode(expected);
  return theirs.byteLength === ours.byteLength && timingSafeEqual(theirs, ours);
}

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
  if (
    !verifyToken ||
    searchParams.get("hub.mode") !== "subscribe" ||
    searchParams.get("hub.verify_token") !== verifyToken
  )
    return undefined;
  const challenge = searchParams.get("hub.challenge");
  return challenge === null || challenge === "" ? undefined : { challenge };
}

/**
POST event handler. Always resolves (never throws) so the route can
respond 200 within 2s regardless of payload shape or dedupe outcome —
Strava disables webhooks that don't get a fast 200.

**Only our own subscription's events are accepted** (STR-4, SA-M6). The
route answers only at the callback key (`isStravaCallbackKey`), and this
is the second check: `subscription_id` is compared before the queue is
touched, and a deployment with no `STRAVA_SUBSCRIPTION_ID` accepts nothing
— fail closed, as an unset verify token already refuses the handshake. An
`event_time` more than `MAX_EVENT_AHEAD_SECONDS` past `now` is dropped.
*/
export async function handleStravaWebhookEvent(
  queue: ReminderQueueProducer,
  captureException: (error: unknown, context: Record<string, string>) => void,
  body: unknown,
  subscriptionId: string | undefined,
  now: number = nowSeconds(),
): Promise<void> {
  // Ours first, and silently. A body that does not even name our
  // subscription is someone else's noise — reporting it, or reporting that
  // it failed to parse, would let anyone fill Sentry as easily as they
  // could have filled the queue.
  const claimed = subscriptionSchema.safeParse(body);
  if (
    !claimed.success ||
    String(claimed.data.subscription_id) !== subscriptionId
  ) {
    return;
  }
  // Only an event that claims to be ours is worth a report when it will
  // not parse: that is Strava changing its payload, which a human must see.
  const parsed = webhookEventSchema.safeParse(body);
  if (!parsed.success) {
    captureException(new Error("invalid strava webhook payload"), {
      surface: "strava-webhook",
    });
    return;
  }
  const event = parsed.data;
  if (event.event_time > now + MAX_EVENT_AHEAD_SECONDS) return;

  if (isDeauthorization(event)) {
    await queue.send({
      type: "strava_deauthorize",
      athleteId: String(event.owner_id),
      eventTime: event.event_time,
    });
    return;
  }
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

const notFound = (): Response => new Response("Not found", { status: 404 });

/**
 * The GET handshake at `/api/strava/<key>`: 404 for any other key, 403 for
 * a handshake that does not check out, else the echoed challenge.
 */
export function stravaHandshakeResponse(
  presentedKey: string,
  expectedKey: string | undefined,
  searchParams: URLSearchParams,
  verifyToken: string | undefined,
): Response {
  if (!isStravaCallbackKey(presentedKey, expectedKey)) return notFound();
  const result = verifyStravaChallenge(searchParams, verifyToken);
  return result === undefined
    ? new Response("Forbidden", { status: 403 })
    : Response.json({ "hub.challenge": result.challenge });
}

/**
 * An event delivery at `/api/strava/<key>`. Any other key is a 404 before
 * the body is read. At the key it is always a 200, whatever the body,
 * because Strava disables a subscription that does not get one promptly.
 * Only the key's holder can post here, so a body that is not JSON is worth
 * a report: it is Strava changing its payload.
 */
export async function stravaDeliveryResponse(
  presentedKey: string,
  expectedKey: string | undefined,
  request: Request,
  queue: ReminderQueueProducer,
  captureException: (error: unknown, context: Record<string, string>) => void,
  subscriptionId: string | undefined,
): Promise<Response> {
  if (!isStravaCallbackKey(presentedKey, expectedKey)) return notFound();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    captureException(new Error("strava webhook body is not JSON"), {
      surface: "strava-webhook",
    });
    return new Response();
  }
  await handleStravaWebhookEvent(queue, captureException, body, subscriptionId);
  // An empty 200, Response's default.
  return new Response();
}
