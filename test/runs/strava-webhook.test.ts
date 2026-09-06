import { describe, expect, it } from "vitest";

import { stravaConnections } from "../../src/db/schema-core";
import { newUlid } from "../../src/lib/ids";
import { coreDb } from "../../src/modules/runs/core-db";
import { unreadNotificationCount } from "../../src/modules/runs/notifications";
import type { ReminderJob } from "../../src/modules/runs/queue-messages";
import {
  handleStravaWebhookEvent,
  verifyStravaChallenge,
} from "../../src/modules/runs/strava/webhook";

function fakeQueue() {
  const sent: ReminderJob[] = [];
  return {
    sent,
    send: (message: ReminderJob) => {
      sent.push(message);
      return Promise.resolve();
    },
  };
}

function fakeCaptureException() {
  const errors: { error: unknown; context: Record<string, string> }[] = [];
  return {
    errors,
    captureException: (error: unknown, context: Record<string, string>) => {
      errors.push({ error, context });
    },
  };
}

async function connectAthlete(
  db: ReturnType<typeof coreDb>,
  athleteId: string,
): Promise<string> {
  const userId = newUlid();
  await db.insert(stravaConnections).values({
    userId,
    athleteId,
    accessToken: "access",
    refreshToken: "refresh",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    status: "ok",
  });
  return userId;
}

// Dedupe is keyed on (object_id, aspect_type, event_time); the D1 instance
// isn't reset between `it` blocks in this file, so each test needs its own
// object_id unless it deliberately reuses one (the dedupe test itself).
const objectIdCounter = { next: 1 };

function activityCreateEvent(overrides: Record<string, unknown> = {}) {
  return {
    object_type: "activity",
    object_id: objectIdCounter.next++,
    aspect_type: "create",
    owner_id: 111,
    subscription_id: 1,
    event_time: 1_700_000_000,
    ...overrides,
  };
}

function challengeParams(entries: Record<string, string>): URLSearchParams {
  return new URLSearchParams(entries);
}

describe("verifyStravaChallenge (GET subscription handshake)", () => {
  const params = challengeParams;

  it("echoes the challenge when mode and verify token match", () => {
    const result = verifyStravaChallenge(
      params({
        "hub.mode": "subscribe",
        "hub.verify_token": "secret",
        "hub.challenge": "abc123",
      }),
      "secret",
    );
    expect(result).toEqual({ challenge: "abc123" });
  });

  it("rejects a mismatched verify token", () => {
    const result = verifyStravaChallenge(
      params({
        "hub.mode": "subscribe",
        "hub.verify_token": "wrong",
        "hub.challenge": "abc123",
      }),
      "secret",
    );
    expect(result).toBeUndefined();
  });

  it("rejects when the deployment has no verify token configured", () => {
    const result = verifyStravaChallenge(
      params({
        "hub.mode": "subscribe",
        "hub.verify_token": "secret",
        "hub.challenge": "abc123",
      }),
      undefined,
    );
    expect(result).toBeUndefined();
  });
});

describe("handleStravaWebhookEvent (POST — always resolves, D-33)", () => {
  it("enqueues a reminder with zero activity data for a connected athlete", async () => {
    const db = coreDb();
    const queue = fakeQueue();
    const capture = fakeCaptureException();
    const userId = await connectAthlete(db, "111");
    const event = activityCreateEvent();

    await handleStravaWebhookEvent(db, queue, capture.captureException, event);

    expect(queue.sent).toEqual([
      { type: "strava_reminder", userId, subjectId: String(event.object_id) },
    ]);
  });

  it("is a no-op for an unknown/unconnected athlete", async () => {
    const db = coreDb();
    const queue = fakeQueue();
    const capture = fakeCaptureException();

    await handleStravaWebhookEvent(
      db,
      queue,
      capture.captureException,
      activityCreateEvent({ owner_id: 999_999 }),
    );

    expect(queue.sent).toHaveLength(0);
    expect(capture.errors).toHaveLength(0);
  });

  it("logs and never throws on an invalid payload", async () => {
    const db = coreDb();
    const queue = fakeQueue();
    const capture = fakeCaptureException();

    await expect(
      handleStravaWebhookEvent(db, queue, capture.captureException, {
        garbage: true,
      }),
    ).resolves.toBeUndefined();

    expect(queue.sent).toHaveLength(0);
    expect(capture.errors).toHaveLength(1);
  });

  it("ignores non-activity and non-create events", async () => {
    const db = coreDb();
    const queue = fakeQueue();
    const capture = fakeCaptureException();
    await connectAthlete(db, "111");

    await handleStravaWebhookEvent(
      db,
      queue,
      capture.captureException,
      activityCreateEvent({ aspect_type: "update" }),
    );
    await handleStravaWebhookEvent(
      db,
      queue,
      capture.captureException,
      activityCreateEvent({ object_type: "athlete" }),
    );

    expect(queue.sent).toHaveLength(0);
  });

  it("dedupes redelivered events via processed_webhook_events", async () => {
    const db = coreDb();
    const queue = fakeQueue();
    const capture = fakeCaptureException();
    await connectAthlete(db, "111");
    const event = activityCreateEvent();

    await handleStravaWebhookEvent(db, queue, capture.captureException, event);
    await handleStravaWebhookEvent(db, queue, capture.captureException, event);

    expect(queue.sent).toHaveLength(1);
  });
});

describe("consumer wiring: strava_reminder job produces the notification", () => {
  it("carries no distance/pace/time — the body is fixed copy (D-33)", async () => {
    const db = coreDb();
    const queue = fakeQueue();
    const capture = fakeCaptureException();
    const userId = await connectAthlete(db, "111");

    await handleStravaWebhookEvent(
      db,
      queue,
      capture.captureException,
      activityCreateEvent(),
    );

    // The webhook itself never creates the notification directly (that's
    // consumer.ts's processReminderJob, tested in consumer.test.ts) — this
    // asserts the job handed to the queue carries nothing but ids.
    expect(new Set(Object.keys(queue.sent[0] ?? {}))).toEqual(
      new Set(["subjectId", "type", "userId"]),
    );
    expect(await unreadNotificationCount(db, userId)).toBe(0);
  });
});
