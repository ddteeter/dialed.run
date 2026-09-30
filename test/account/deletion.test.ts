import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { account, session } from "../../src/db/schema-auth";
import {
  accountDeletions,
  outbox,
  stravaConnections,
  stravaRevocations,
} from "../../src/db/schema-core";
import { waitUntil } from "../../src/env";
import { DELETION_GRACE_S } from "../../src/lib/contracts";
import { proseDayLabel } from "../../src/lib/dates";
import { newUlid } from "../../src/lib/ids";
import type { PasswordCheck } from "../../src/modules/auth";
import {
  deletionEffectsFromEnv,
  FRESH_SIGN_IN_S,
  keepAccount,
  leavingView,
  pendingDeletionOf,
  requestAccountDeletion,
  type DeletionEffects,
} from "../../src/modules/account/deletion";
import { captureException, settleOutbox } from "../../src/modules/ops";
import { core, fakeMail, owedTo, seedUser } from "../email/helpers";

/**
 * Deleting an account (task 126, ACC-9) on real D1: the proof it asks
 * for, the claim, every session gone, the email owed and sent after the
 * answer, Strava disconnected — and Keep, while it still can.
 */

const db = core();
const NOW = 1_800_000_000;

/**
Better Auth's `credential` account row, which is what "has a password" reads.
*/
async function withPassword(userId: string): Promise<void> {
  const now = new Date();
  await db.insert(account).values({
    id: newUlid(),
    issuer: "local",
    accountId: userId,
    providerId: "credential",
    userId,
    password: "hash",
    createdAt: now,
    updatedAt: now,
  });
}

/**
A live session row for this runner, as a sign-in would leave.
*/
async function sessionFor(userId: string): Promise<string> {
  const id = newUlid();
  const now = new Date();
  await db.insert(session).values({
    id,
    userId,
    token: `token-${id}`,
    expiresAt: new Date(now.getTime() + 86_400_000),
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function sessionsOf(userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: session.id })
    .from(session)
    .where(eq(session.userId, userId));
  return rows.map((row) => row.id);
}

async function claimOf(userId: string) {
  const rows = await db
    .select()
    .from(accountDeletions)
    .where(eq(accountDeletions.userId, userId));
  return rows.map((row) => ({
    ...row,
    purgeStartedAt: row.purgeStartedAt ?? undefined,
  }));
}

async function owedFor(userId: string) {
  return db
    .select({ kind: outbox.kind, key: outbox.dedupeKey })
    .from(outbox)
    .where(
      eq(
        outbox.dedupeKey,
        `deletion_scheduled:${userId}:${String(NOW + DELETION_GRACE_S)}`,
      ),
    );
}

function checks(result: PasswordCheck) {
  return vi.fn<(password: string) => Promise<PasswordCheck>>(() =>
    Promise.resolve(result),
  );
}

/**
The platform's side, faked: the email held until `settled()`.
*/
function effectsFor(mail: ReturnType<typeof fakeMail>) {
  const later = owedTo(mail);
  const keepAlive = vi.fn(later.owed.keepAlive);
  const report = vi.fn(later.owed.report);
  const disconnectStrava = vi.fn<(userId: string) => Promise<void>>(() =>
    Promise.resolve(),
  );
  const effects: DeletionEffects = {
    ...later.owed,
    keepAlive,
    report,
    disconnectStrava,
  };
  return {
    effects,
    keepAlive,
    report,
    disconnectStrava,
    settled: later.settled,
  };
}

describe("requestAccountDeletion", () => {
  it("schedules a password account's deletion: the claim, every session gone, the email owed then sent, Strava disconnected", async () => {
    const mail = fakeMail();
    const fx = effectsFor(mail);
    const { userId, email } = await seedUser();
    await withPassword(userId);
    await sessionFor(userId);
    await sessionFor(userId);
    const bystander = await seedUser();
    const theirs = await sessionFor(bystander.userId);
    const checkPassword = checks({ status: "own" });

    const purgeAfter = NOW + DELETION_GRACE_S;
    expect(
      await requestAccountDeletion(
        db,
        {
          userId,
          currentPassword: "hunter22",
          checkPassword,
          signedInAt: NOW - 86_400,
        },
        fx.effects,
        NOW,
      ),
    ).toStrictEqual({ status: "scheduled", purgeAfter });
    expect(DELETION_GRACE_S).toBe(604_800);

    expect(checkPassword).toHaveBeenCalledTimes(1);
    expect(checkPassword).toHaveBeenCalledWith("hunter22");
    expect(await claimOf(userId)).toStrictEqual([
      { userId, requestedAt: NOW, purgeAfter, purgeStartedAt: undefined },
    ]);
    expect(await sessionsOf(userId)).toStrictEqual([]);
    expect(await sessionsOf(bystander.userId)).toStrictEqual([theirs]);
    expect(await owedFor(userId)).toStrictEqual([
      {
        kind: "email",
        key: `deletion_scheduled:${userId}:${String(purgeAfter)}`,
      },
    ]);
    expect(fx.disconnectStrava).toHaveBeenCalledTimes(1);
    expect(fx.disconnectStrava).toHaveBeenCalledWith(userId);
    expect(fx.report).not.toHaveBeenCalled();

    // Owed, kept alive, and not sent until the Worker's background work runs.
    expect(fx.keepAlive).toHaveBeenCalledTimes(1);
    expect(mail.sent).toHaveLength(0);
    await fx.settled();
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]).toMatchObject({
      to: email,
      subject: `Your dialed.run account goes on ${proseDayLabel(purgeAfter)}`,
    });
    expect(await owedFor(userId)).toStrictEqual([]);
  });

  it("refuses a wrong password, and writes nothing", async () => {
    const mail = fakeMail();
    const fx = effectsFor(mail);
    const { userId } = await seedUser();
    await withPassword(userId);
    const kept = await sessionFor(userId);
    const checkPassword = checks({ status: "wrong" });

    expect(
      await requestAccountDeletion(
        db,
        {
          userId,
          currentPassword: "not-it",
          checkPassword,
          signedInAt: NOW,
        },
        fx.effects,
        NOW,
      ),
    ).toStrictEqual({ status: "wrong-password" });
    expect(checkPassword).toHaveBeenCalledWith("not-it");
    expect(await claimOf(userId)).toStrictEqual([]);
    expect(await sessionsOf(userId)).toStrictEqual([kept]);
    expect(await owedFor(userId)).toStrictEqual([]);
    expect(fx.keepAlive).not.toHaveBeenCalled();
    expect(fx.disconnectStrava).not.toHaveBeenCalled();
    await fx.settled();
    expect(mail.sent).toHaveLength(0);
  });

  it("refuses while the tries are used up, saying until when", async () => {
    const fx = effectsFor(fakeMail());
    const { userId } = await seedUser();
    await withPassword(userId);

    expect(
      await requestAccountDeletion(
        db,
        {
          userId,
          currentPassword: "hunter22",
          checkPassword: checks({ status: "limited", until: NOW + 900 }),
          signedInAt: NOW,
        },
        fx.effects,
        NOW,
      ),
    ).toStrictEqual({ status: "password-limited", until: NOW + 900 });
    expect(await claimOf(userId)).toStrictEqual([]);
    expect(fx.disconnectStrava).not.toHaveBeenCalled();
  });

  it("checks an empty password when a password account sent none", async () => {
    const fx = effectsFor(fakeMail());
    const { userId } = await seedUser();
    await withPassword(userId);
    const checkPassword = checks({ status: "wrong" });

    expect(
      await requestAccountDeletion(
        db,
        {
          userId,
          currentPassword: undefined,
          checkPassword,
          signedInAt: NOW,
        },
        fx.effects,
        NOW,
      ),
    ).toStrictEqual({ status: "wrong-password" });
    expect(checkPassword).toHaveBeenCalledTimes(1);
    expect(checkPassword).toHaveBeenCalledWith("");
  });

  it("takes a Google-only account's sign-in within ten minutes instead of a password", async () => {
    expect(FRESH_SIGN_IN_S).toBe(600);
    for (const signedInAt of [NOW, NOW - FRESH_SIGN_IN_S]) {
      const fx = effectsFor(fakeMail());
      const { userId } = await seedUser();
      const checkPassword = checks({ status: "wrong" });

      expect(
        await requestAccountDeletion(
          db,
          {
            userId,
            currentPassword: undefined,
            checkPassword,
            signedInAt,
          },
          fx.effects,
          NOW,
        ),
      ).toStrictEqual({
        status: "scheduled",
        purgeAfter: NOW + DELETION_GRACE_S,
      });
      expect(checkPassword).not.toHaveBeenCalled();
      expect(await claimOf(userId)).toHaveLength(1);
      await fx.settled();
    }
  });

  it("asks a Google-only account to sign in again when its sign-in is older, and writes nothing", async () => {
    const mail = fakeMail();
    const fx = effectsFor(mail);
    const { userId } = await seedUser();
    const kept = await sessionFor(userId);
    const checkPassword = checks({ status: "own" });

    expect(
      await requestAccountDeletion(
        db,
        {
          userId,
          currentPassword: "hunter22",
          checkPassword,
          signedInAt: NOW - FRESH_SIGN_IN_S - 1,
        },
        fx.effects,
        NOW,
      ),
    ).toStrictEqual({ status: "reauth" });
    expect(checkPassword).not.toHaveBeenCalled();
    expect(await claimOf(userId)).toStrictEqual([]);
    expect(await sessionsOf(userId)).toStrictEqual([kept]);
    expect(await owedFor(userId)).toStrictEqual([]);
    expect(fx.disconnectStrava).not.toHaveBeenCalled();
    await fx.settled();
    expect(mail.sent).toHaveLength(0);
  });

  it("keeps the first request's date on a second request, and says that date again", async () => {
    const mail = fakeMail();
    const { userId } = await seedUser();
    await withPassword(userId);
    const purgeAfter = NOW + DELETION_GRACE_S;
    const request = {
      userId,
      currentPassword: "hunter22",
      checkPassword: checks({ status: "own" }),
      signedInAt: NOW,
    };

    const first = effectsFor(mail);
    await requestAccountDeletion(db, request, first.effects, NOW);
    await first.settled();
    const second = effectsFor(mail);
    expect(
      await requestAccountDeletion(db, request, second.effects, NOW + 86_400),
    ).toStrictEqual({ status: "scheduled", purgeAfter });
    await second.settled();

    expect(await claimOf(userId)).toStrictEqual([
      { userId, requestedAt: NOW, purgeAfter, purgeStartedAt: undefined },
    ]);
    const subject = `Your dialed.run account goes on ${proseDayLabel(purgeAfter)}`;
    expect(mail.sent.map((message) => message.subject)).toStrictEqual([
      subject,
      subject,
    ]);
  });

  it("still schedules the deletion when Strava fails to disconnect, and reports it", async () => {
    const mail = fakeMail();
    const fx = effectsFor(mail);
    const failure = new Error("strava down");
    fx.disconnectStrava.mockRejectedValueOnce(failure);
    const { userId } = await seedUser();
    await withPassword(userId);

    expect(
      await requestAccountDeletion(
        db,
        {
          userId,
          currentPassword: "hunter22",
          checkPassword: checks({ status: "own" }),
          signedInAt: NOW,
        },
        fx.effects,
        NOW,
      ),
    ).toStrictEqual({
      status: "scheduled",
      purgeAfter: NOW + DELETION_GRACE_S,
    });
    expect(fx.report).toHaveBeenCalledTimes(1);
    expect(fx.report).toHaveBeenCalledWith(failure, {
      surface: "account-deletion-strava",
      userId,
    });
    expect(await claimOf(userId)).toHaveLength(1);
    await fx.settled();
    expect(mail.sent).toHaveLength(1);
  });
});

describe("keepAccount", () => {
  it("keeps an account whose purge has not started, and the claim goes", async () => {
    const { userId } = await seedUser();
    await db
      .insert(accountDeletions)
      .values({ userId, requestedAt: NOW, purgeAfter: NOW + DELETION_GRACE_S });

    expect(await keepAccount(db, userId)).toBe("kept");
    expect(await claimOf(userId)).toStrictEqual([]);
    expect(await pendingDeletionOf(db, userId)).toBeUndefined();
  });

  it("is too late once the purge has claimed the row, which stays", async () => {
    const { userId } = await seedUser();
    const claim = {
      userId,
      requestedAt: NOW,
      purgeAfter: NOW + DELETION_GRACE_S,
      purgeStartedAt: NOW + DELETION_GRACE_S + 60,
    };
    await db.insert(accountDeletions).values(claim);

    expect(await keepAccount(db, userId)).toBe("too-late");
    expect(await claimOf(userId)).toStrictEqual([claim]);
  });

  it("calls an account with no deletion pending kept already", async () => {
    const { userId } = await seedUser();
    expect(await keepAccount(db, userId)).toBe("kept");
    expect(await claimOf(userId)).toStrictEqual([]);
  });

  it("touches only its own runner's claim", async () => {
    const { userId } = await seedUser();
    const other = await seedUser();
    await db.insert(accountDeletions).values([
      { userId, requestedAt: NOW, purgeAfter: NOW + DELETION_GRACE_S },
      {
        userId: other.userId,
        requestedAt: NOW,
        purgeAfter: NOW + DELETION_GRACE_S,
      },
    ]);
    expect(await keepAccount(db, userId)).toBe("kept");
    expect(await pendingDeletionOf(db, other.userId)).toStrictEqual({
      purgeAfter: NOW + DELETION_GRACE_S,
    });
  });
});

describe("pendingDeletionOf", () => {
  it("reads the runner's own date, and nothing for a runner with none", async () => {
    const { userId } = await seedUser();
    const other = await seedUser();
    await db
      .insert(accountDeletions)
      .values({ userId, requestedAt: NOW, purgeAfter: NOW + 1234 });

    expect(await pendingDeletionOf(db, userId)).toStrictEqual({
      purgeAfter: NOW + 1234,
    });
    expect(await pendingDeletionOf(db, other.userId)).toBeUndefined();
  });
});

describe("leavingView", () => {
  it("asks a signed-in runner inside the week whether to keep the account", async () => {
    const { userId } = await seedUser();
    const purgeAfter = NOW + DELETION_GRACE_S;
    await db
      .insert(accountDeletions)
      .values({ userId, requestedAt: NOW, purgeAfter });

    expect(await leavingView(db, userId, undefined)).toStrictEqual({
      state: "ask",
      day: proseDayLabel(purgeAfter),
    });
    // The pending date wins over whatever the link carried.
    expect(await leavingView(db, userId, NOW)).toStrictEqual({
      state: "ask",
      day: proseDayLabel(purgeAfter),
    });
  });

  it("shows nothing to a signed-in runner with no deletion pending", async () => {
    const { userId } = await seedUser();
    expect(await leavingView(db, userId, NOW)).toStrictEqual({
      state: "none",
    });
  });

  it("tells a signed-out runner the date their request answered", async () => {
    expect(await leavingView(db, undefined, NOW)).toStrictEqual({
      state: "scheduled",
      day: proseDayLabel(NOW),
    });
    expect(proseDayLabel(NOW)).not.toBe(proseDayLabel(NOW + DELETION_GRACE_S));
  });

  it("shows nothing to a signed-out visitor with no date", async () => {
    expect(await leavingView(db, undefined, undefined)).toStrictEqual({
      state: "none",
    });
  });
});

describe("deletionEffectsFromEnv", () => {
  it("wires the platform: waitUntil, Sentry, the outbox fast path", () => {
    const effects = deletionEffectsFromEnv();
    expect(effects.keepAlive).toBe(waitUntil);
    expect(effects.report).toBe(captureException);
    expect(effects.settle).toBe(settleOutbox);
  });

  it("disconnects Strava through runs' own primitive: the connection gone, the revocation owed", async () => {
    const { userId } = await seedUser();
    const refreshToken = `refresh-${newUlid()}`;
    await db.insert(stravaConnections).values({
      userId,
      athleteId: `athlete-${userId}`,
      refreshToken,
    });

    await deletionEffectsFromEnv().disconnectStrava(userId);

    expect(
      await db
        .select()
        .from(stravaConnections)
        .where(eq(stravaConnections.userId, userId)),
    ).toStrictEqual([]);
    expect(
      await db
        .select({ refreshToken: stravaRevocations.refreshToken })
        .from(stravaRevocations)
        .where(eq(stravaRevocations.refreshToken, refreshToken)),
    ).toStrictEqual([{ refreshToken }]);
  });
});
