import { describe, expect, it } from "vitest";

import type {
  DeauthorizeJob,
  ReminderJob,
} from "../../src/modules/runs/queue-messages";
import {
  handleStravaWebhookEvent,
  verifyStravaChallenge,
} from "../../src/modules/runs/strava/webhook";

function fakeQueue() {
  const sent: (ReminderJob | DeauthorizeJob)[] = [];
  return {
    sent,
    send: (message: ReminderJob | DeauthorizeJob) => {
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

/**
 * Our subscription, as `STRAVA_SUBSCRIPTION_ID` holds it — a string,
 * where the event carries a number.
 */
const OUR_SUBSCRIPTION = "1";

/**
 * A delivery to this deployment's subscription.
 */
async function deliver(
  queue: ReturnType<typeof fakeQueue>,
  captureException: ReturnType<typeof fakeCaptureException>["captureException"],
  body: unknown,
): Promise<void> {
  await handleStravaWebhookEvent(
    queue,
    captureException,
    body,
    OUR_SUBSCRIPTION,
  );
}

function deauthorizationEvent(authorized: unknown = "false") {
  return {
    aspect_type: "update",
    object_type: "athlete",
    updates: { authorized },
    owner_id: 134_815,
    subscription_id: 1,
    event_time: 1_516_126_040,
    object_id: 134_815,
  };
}

describe("the webhook authenticates by subscription (STR-4)", () => {
  it("drops a forged event before the queue, and says nothing", async () => {
    const queue = fakeQueue();
    const capture = fakeCaptureException();

    await handleStravaWebhookEvent(
      queue,
      capture.captureException,
      activityCreateEvent({ subscription_id: 2 }),
      OUR_SUBSCRIPTION,
    );
    await handleStravaWebhookEvent(
      queue,
      capture.captureException,
      deauthorizationEvent(),
      "999",
    );

    expect(queue.sent).toStrictEqual([]);
    expect(capture.errors).toStrictEqual([]);
  });

  it("accepts nothing when no subscription is configured (fail closed)", async () => {
    const queue = fakeQueue();
    const capture = fakeCaptureException();

    await handleStravaWebhookEvent(
      queue,
      capture.captureException,
      activityCreateEvent(),
      undefined,
    );

    expect(queue.sent).toStrictEqual([]);
  });
});

describe("athlete deauthorization (STR-3)", () => {
  it.each([
    ["the string Strava's docs describe", "false"],
    ["the boolean Strava's example sends", false],
  ])("enqueues a deauthorization for %s", async (_label, authorized) => {
    const queue = fakeQueue();
    const capture = fakeCaptureException();

    await deliver(
      queue,
      capture.captureException,
      deauthorizationEvent(authorized),
    );

    expect(queue.sent).toStrictEqual([
      {
        type: "strava_deauthorize",
        athleteId: "134815",
        eventTime: 1_516_126_040,
      },
    ]);
    expect(capture.errors).toStrictEqual([]);
  });

  it("treats an athlete event without authorized=false as nothing", async () => {
    const queue = fakeQueue();
    const capture = fakeCaptureException();

    await deliver(queue, capture.captureException, {
      ...deauthorizationEvent(),
      updates: {},
    });

    expect(queue.sent).toStrictEqual([]);
  });

  it("refuses an authorized value that is not false", async () => {
    const queue = fakeQueue();
    const capture = fakeCaptureException();

    await deliver(
      queue,
      capture.captureException,
      deauthorizationEvent("true"),
    );

    expect(queue.sent).toStrictEqual([]);
    expect(capture.errors).toHaveLength(1);
  });

  it("does not treat an activity carrying authorized=false as a deauthorization", async () => {
    const queue = fakeQueue();
    const capture = fakeCaptureException();

    await deliver(
      queue,
      capture.captureException,
      activityCreateEvent({ updates: { authorized: "false" } }),
    );

    expect(queue.sent[0]?.type).toBe("strava_reminder");
  });
});

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

    await deliver(queue, capture.captureException, event);

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

    await deliver(
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
      deliver(queue, capture.captureException, {
        garbage: true,
      }),
    ).resolves.toBeUndefined();

    expect(queue.sent).toHaveLength(0);
    expect(capture.errors).toHaveLength(1);
    const [reported] = capture.errors;
    expect(reported?.error).toBeInstanceOf(Error);
    expect((reported?.error as Error).message).toBe(
      "invalid strava webhook payload",
    );
    // The surface tag is what makes this findable in Sentry among every
    // other parse failure in the app.
    expect(reported?.context).toStrictEqual({ surface: "strava-webhook" });
  });

  it.each([
    ["a non-create activity event", { aspect_type: "update" }],
    ["a deleted activity", { aspect_type: "delete" }],
    ["an athlete event", { object_type: "athlete" }],
  ])("ignores %s in silence", async (_label, overrides) => {
    // Silence, not just an empty queue: every one of these is a shape
    // Strava really sends, so recognising it and declining to act is the
    // behaviour. Reporting it to Sentry would be noise.
    const queue = fakeQueue();
    const capture = fakeCaptureException();

    await deliver(
      queue,
      capture.captureException,
      activityCreateEvent(overrides),
    );

    expect(queue.sent).toHaveLength(0);
    expect(capture.errors).toHaveLength(0);
  });

  it("carries no distance, pace or time — only ids and the event time (D-33)", async () => {
    const queue = fakeQueue();
    const capture = fakeCaptureException();

    await deliver(queue, capture.captureException, activityCreateEvent());

    expect(new Set(Object.keys(queue.sent[0] ?? {}))).toEqual(
      new Set(["type", "athleteId", "objectId", "aspectType", "eventTime"]),
    );
  });
});

function params(entries: Record<string, string>): URLSearchParams {
  return new URLSearchParams(entries);
}

describe("verifyStravaChallenge: every reason it refuses", () => {
  const GOOD = {
    "hub.mode": "subscribe",
    "hub.verify_token": "the-token",
    "hub.challenge": "echo-me",
  };

  it("echoes the challenge exactly", () => {
    expect(verifyStravaChallenge(params(GOOD), "the-token")).toStrictEqual({
      challenge: "echo-me",
    });
  });

  it("refuses an empty verify token as firmly as a missing one", () => {
    // An unset secret reads back as "" as often as undefined, and an empty
    // token would otherwise match an empty `hub.verify_token`.
    expect(verifyStravaChallenge(params(GOOD), undefined)).toBeUndefined();
    expect(verifyStravaChallenge(params(GOOD), "")).toBeUndefined();
    expect(
      verifyStravaChallenge(params({ ...GOOD, "hub.verify_token": "" }), ""),
    ).toBeUndefined();
  });

  it("refuses any mode but subscribe", () => {
    expect(
      verifyStravaChallenge(
        params({ ...GOOD, "hub.mode": "unsubscribe" }),
        "the-token",
      ),
    ).toBeUndefined();
    expect(
      verifyStravaChallenge(
        params({ "hub.verify_token": "the-token", "hub.challenge": "x" }),
        "the-token",
      ),
    ).toBeUndefined();
  });

  it("refuses a token that does not match, exactly", () => {
    expect(
      verifyStravaChallenge(
        params({ ...GOOD, "hub.verify_token": "the-token " }),
        "the-token",
      ),
    ).toBeUndefined();
  });

  it("refuses a missing or empty challenge", () => {
    // Echoing "" back is not a handshake; Strava reads it as a failure
    // either way, and answering 403 is the honest response.
    expect(
      verifyStravaChallenge(
        params({ "hub.mode": "subscribe", "hub.verify_token": "the-token" }),
        "the-token",
      ),
    ).toBeUndefined();
    expect(
      verifyStravaChallenge(
        params({ ...GOOD, "hub.challenge": "" }),
        "the-token",
      ),
    ).toBeUndefined();
  });
});
