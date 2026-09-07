import { describe, expect, it } from "vitest";

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
  /**
   * The handler no longer touches the database at all. Strava disables a
   * subscription that does not answer promptly, so the connection lookup
   * and the dedupe moved to the consumer, which had to be idempotent
   * anyway. These tests assert the response path stays that thin.
   */
  it("enqueues a reminder carrying only ids, without a database round trip", async () => {
    const queue = fakeQueue();
    const capture = fakeCaptureException();
    const event = activityCreateEvent();

    await handleStravaWebhookEvent(queue, capture.captureException, event);

    expect(queue.sent).toEqual([
      {
        type: "strava_reminder",
        athleteId: String(event.owner_id),
        objectId: String(event.object_id),
        aspectType: "create",
        eventTime: event.event_time,
      },
    ]);
  });

  it("enqueues for an athlete it cannot resolve — that is the consumer's job", async () => {
    const queue = fakeQueue();
    const capture = fakeCaptureException();

    await handleStravaWebhookEvent(
      queue,
      capture.captureException,
      activityCreateEvent({ owner_id: 999_999 }),
    );

    // Deliberately enqueued: resolving athlete -> user needs a query, and
    // a query is what we are keeping off the response path. An unknown
    // athlete is dropped by the consumer.
    expect(queue.sent).toHaveLength(1);
    expect(capture.errors).toHaveLength(0);
  });

  it("logs and never throws on an invalid payload", async () => {
    const queue = fakeQueue();
    const capture = fakeCaptureException();

    await expect(
      handleStravaWebhookEvent(queue, capture.captureException, {
        garbage: true,
      }),
    ).resolves.toBeUndefined();

    expect(queue.sent).toHaveLength(0);
    expect(capture.errors).toHaveLength(1);
  });

  it("ignores non-activity and non-create events", async () => {
    const queue = fakeQueue();
    const capture = fakeCaptureException();

    await handleStravaWebhookEvent(
      queue,
      capture.captureException,
      activityCreateEvent({ aspect_type: "update" }),
    );
    await handleStravaWebhookEvent(
      queue,
      capture.captureException,
      activityCreateEvent({ object_type: "athlete" }),
    );

    expect(queue.sent).toHaveLength(0);
  });

  it("carries no distance, pace or time — only ids and the event time (D-33)", async () => {
    const queue = fakeQueue();
    const capture = fakeCaptureException();

    await handleStravaWebhookEvent(
      queue,
      capture.captureException,
      activityCreateEvent(),
    );

    expect(new Set(Object.keys(queue.sent[0] ?? {}))).toEqual(
      new Set(["type", "athleteId", "objectId", "aspectType", "eventTime"]),
    );
  });
});
