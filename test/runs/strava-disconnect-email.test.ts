/**
 * Legal-readiness C3: disconnecting Strava in the app sends the same
 * "Strava disconnected" email a disconnect from Strava's side does, and
 * the two together send exactly one. An account deletion's disconnect
 * sends none.
 */
import { and, eq, like } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  notifications,
  outbox,
  stravaConnections,
  stravaRevocations,
} from "../../src/db/schema-core";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { deletionEffectsFromEnv } from "../../src/modules/account/deletion";
import { coreDb } from "../../src/modules/runs/core-db";
import { deauthorizeAthlete } from "../../src/modules/runs/strava/deauthorize";
import {
  disconnectStrava,
  disconnectStravaAndTell,
  getStravaConnection,
} from "../../src/modules/runs/strava/oauth";
import { oweInCore } from "../queue-fakes";

function reportUnexpected(error: unknown): void {
  throw new Error(`unexpected report: ${String(error)}`);
}

function noReports(): (error: unknown) => void {
  return reportUnexpected;
}

async function seedConnection(): Promise<{
  userId: string;
  athleteId: string;
  refreshToken: string;
}> {
  const userId = newUlid();
  const athleteId = `athlete-${newUlid()}`;
  const refreshToken = `refresh-${newUlid()}`;
  await coreDb()
    .insert(stravaConnections)
    .values({ userId, athleteId, refreshToken, connectedAt: 1000 });
  return { userId, athleteId, refreshToken };
}

/**
Every "Strava disconnected" email owed to this runner, as outbox rows.
*/
async function disconnectEmailsTo(
  userId: string,
): Promise<{ dedupeKey: string; payload: unknown }[]> {
  const rows = await coreDb()
    .select({ dedupeKey: outbox.dedupeKey, payload: outbox.payload })
    .from(outbox)
    .where(
      and(
        eq(outbox.kind, "email"),
        like(outbox.dedupeKey, `strava_disconnected:${userId}:%`),
      ),
    );
  return rows.map((row) => {
    const payload: unknown = JSON.parse(row.payload);
    return { dedupeKey: row.dedupeKey, payload };
  });
}

describe("the runner's own disconnect tells them by email (C3)", () => {
  it("owes one email, in the batch that deletes the connection", async () => {
    const { userId, refreshToken } = await seedConnection();
    const before = nowSeconds();

    await disconnectStravaAndTell(
      coreDb(),
      undefined,
      userId,
      noReports(),
      oweInCore,
    );

    const after = nowSeconds();
    expect(await getStravaConnection(coreDb(), userId)).toBeUndefined();
    expect(
      await coreDb()
        .select({ refreshToken: stravaRevocations.refreshToken })
        .from(stravaRevocations)
        .where(eq(stravaRevocations.refreshToken, refreshToken)),
    ).toStrictEqual([{ refreshToken }]);

    const owed = await disconnectEmailsTo(userId);
    expect(owed).toHaveLength(1);
    const [row] = owed;
    // Keyed by the moment of this disconnect, the webhook's shape.
    const at = Number(row?.dedupeKey.split(":", 3)[2]);
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(after);
    expect(row?.payload).toStrictEqual({
      dedupeKey: `strava_disconnected:${userId}:${String(at)}`,
      email: { to: { userId }, template: { kind: "strava_disconnected" } },
    });
  });

  it("owes nothing when nothing is connected, and a second press owes no second email", async () => {
    const { userId } = await seedConnection();
    const press = () =>
      disconnectStravaAndTell(
        coreDb(),
        undefined,
        userId,
        noReports(),
        oweInCore,
      );

    await press();
    await press();

    expect(await disconnectEmailsTo(userId)).toHaveLength(1);

    const stranger = newUlid();
    await disconnectStravaAndTell(
      coreDb(),
      undefined,
      stranger,
      noReports(),
      oweInCore,
    );
    expect(await disconnectEmailsTo(stranger)).toStrictEqual([]);
  });

  /**
   * Our revoke makes Strava send the deauthorization for this grant. The
   * webhook finds its grant by the connection row, which the in-app
   * disconnect has already deleted, so it owes nothing — not even on a
   * redelivery.
   */
  it("sends one email in all when Strava's deauthorization follows", async () => {
    const { userId, athleteId } = await seedConnection();

    await disconnectStravaAndTell(
      coreDb(),
      undefined,
      userId,
      noReports(),
      oweInCore,
    );
    const eventTime = nowSeconds() + 5;
    await deauthorizeAthlete(coreDb(), athleteId, eventTime, oweInCore);
    await deauthorizeAthlete(coreDb(), athleteId, eventTime, oweInCore);

    expect(await disconnectEmailsTo(userId)).toHaveLength(1);
    // Nor does the webhook's in-app notice repeat what the runner did.
    expect(
      await coreDb()
        .select()
        .from(notifications)
        .where(eq(notifications.userId, userId)),
    ).toStrictEqual([]);
  });
});

describe("an account deletion's disconnect sends no Strava email", () => {
  it("owes none from the primitive the request and the purge bind to", async () => {
    const { userId, athleteId } = await seedConnection();

    await disconnectStrava(coreDb(), undefined, userId, noReports());
    // And Strava's deauthorization, which our revoke prompts, finds no
    // connection to tell anyone about.
    await deauthorizeAthlete(coreDb(), athleteId, nowSeconds(), oweInCore);

    expect(await getStravaConnection(coreDb(), userId)).toBeUndefined();
    expect(await disconnectEmailsTo(userId)).toStrictEqual([]);
  });

  it("owes none from the deletion request's own wiring", async () => {
    const { userId } = await seedConnection();

    await deletionEffectsFromEnv().disconnectStrava(userId);

    expect(await getStravaConnection(coreDb(), userId)).toBeUndefined();
    expect(await disconnectEmailsTo(userId)).toStrictEqual([]);
  });
});
