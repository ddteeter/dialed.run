import { describe, expect, it } from "vitest";

import { newUlid } from "../../src/lib/ids";
import { importsQueueMessageSchema } from "../../src/modules/runs/queue-messages";

/**
 * The wire format between two deploys (law 9).
 *
 * A deploy replaces the consumer while the queue still holds messages the
 * *previous* version enqueued, so every one of these shapes has to keep
 * parsing. The discriminator is what lets a new variant be added without
 * touching the old ones — and what a mutant can quietly break, since the
 * consumer's own tests only ever send the shape they just built.
 */

describe("importsQueueMessageSchema", () => {
  it("parses an import job", () => {
    const importId = newUlid();
    expect(
      importsQueueMessageSchema.parse({ type: "import", importId }),
    ).toStrictEqual({ type: "import", importId });
  });

  it("parses a Strava reminder, ids and event time only", () => {
    // D-33: no distance, pace or time from Strava, ever. The shape is the
    // enforcement — anything else is not part of the contract.
    const message = {
      type: "strava_reminder",
      athleteId: "12345",
      objectId: "98765",
      aspectType: "create",
      eventTime: 1_768_485_600,
    };

    expect(importsQueueMessageSchema.parse(message)).toStrictEqual(message);
  });

  it("parses a revoke job carrying only the outbox row id", () => {
    // The token stays in `strava_revocations`; the message is a pointer to
    // it, so a lost or duplicated delivery costs nothing.
    const revocationId = newUlid();
    expect(
      importsQueueMessageSchema.parse({ type: "strava_revoke", revocationId }),
    ).toStrictEqual({ type: "strava_revoke", revocationId });
  });

  it("refuses a message with no type to dispatch on", () => {
    expect(
      importsQueueMessageSchema.safeParse({ importId: newUlid() }).success,
    ).toBe(false);
    expect(
      importsQueueMessageSchema.safeParse({ type: "unknown_job" }).success,
    ).toBe(false);
  });

  it("refuses each variant missing a field it needs", () => {
    const incomplete = [
      { type: "import" },
      { type: "import", importId: "" },
      { type: "strava_reminder", athleteId: "1", objectId: "2" },
      {
        type: "strava_reminder",
        athleteId: "",
        objectId: "2",
        aspectType: "create",
        eventTime: 1,
      },
      {
        type: "strava_reminder",
        athleteId: "1",
        objectId: "2",
        aspectType: "create",
        eventTime: 1.5,
      },
      { type: "strava_revoke" },
      { type: "strava_revoke", revocationId: "" },
    ];

    for (const message of incomplete) {
      expect(
        importsQueueMessageSchema.safeParse(message).success,
        JSON.stringify(message),
      ).toBe(false);
    }
  });

  it("does not confuse one variant's fields for another's", () => {
    // The discriminator decides which shape applies; without it an import
    // job carrying a revocation id would parse as something.
    expect(
      importsQueueMessageSchema.safeParse({
        type: "import",
        revocationId: newUlid(),
      }).success,
    ).toBe(false);
  });
});
