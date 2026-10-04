import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { account, session, user, verification } from "../../src/db/schema-auth";
import {
  accessRequests,
  accountDeletions,
  blocks,
  dataExports,
  emailSendLimits,
  emailVerifications,
  entryPhotos,
  entryTags,
  follows,
  imports,
  inviteCodes,
  inviteRedemptions,
  notificationPreferences,
  notifications,
  outbox,
  outfitEntries,
  outfitEntryItems,
  passwordAttempts,
  termsAcceptances,
  photoScreenings,
  reactions,
  reports,
  reviewQueue,
  runs,
  stravaConnections,
  stravaRevocations,
  userProfiles,
  usernameHistory,
  wardrobeItems,
} from "../../src/db/schema-core";
import { manualConditions } from "../../src/db/schema-weather";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { orSqlNull } from "../../src/lib/sql/sql-null";
import {
  PURGE_LEASE_S,
  PURGE_PER_FIRING,
  purgeAccount,
  purgeDueAccounts,
} from "../../src/modules/account/purge";
import type { PurgeDeps } from "../../src/modules/account/purge";
import { drainOutbox } from "../../src/modules/ops/outbox";
import { entryAudienceColumns } from "../feed/helpers";

/**
 * ACC-9: the purge at the end of a deletion's week. Every assertion is
 * about what is left in the databases afterwards — the runner's rows gone
 * from every table, everyone else's exactly as they were — because a purge
 * that reported success and left a row behind is the defect.
 */

const NOW = 1_757_000_000;

const core = drizzle(env.DIALED_CORE);
const weather = drizzle(env.DIALED_WEATHER);

interface Recorded {
  readonly deps: PurgeDeps;
  readonly revoked: string[];
  readonly reported: { error: unknown; context: Record<string, string> }[];
}

/**
 * The purge's seams, recording what it asked of them. `failFor` makes the
 * Strava revoke throw for those runners, once each.
 */
function depsAt(now: number, failFor: readonly string[] = []): Recorded {
  const revoked: string[] = [];
  const reported: Recorded["reported"] = [];
  const pending = new Set(failFor);
  return {
    revoked,
    reported,
    deps: {
      core,
      weather,
      now,
      revokeStrava: (userId) => {
        revoked.push(userId);
        if (pending.delete(userId)) {
          return Promise.reject(new Error("Strava is down"));
        }
        return Promise.resolve();
      },
      exportBucket: env.IMPORTS,
      report: (error, context) => {
        reported.push({ error, context });
      },
    },
  };
}

interface Seeded {
  readonly userId: string;
  /**
  As Better Auth stored it: mixed case, which the purge must lower.
  */
  readonly email: string;
  readonly handle: string;
  /**
  The address they redeemed their invite with, before changing it.
  */
  readonly redeemedAs: string;
  readonly runIds: readonly string[];
  readonly entryId: string;
  readonly garmentIds: readonly string[];
  readonly screeningIds: readonly string[];
  readonly looseUploadKey: string;
}

/**
 * One runner with a row of every kind an account accumulates on its own —
 * everything that names only them. Rows between two runners are seeded by
 * the test, after the "before" snapshot.
 */
async function seedAccount(): Promise<Seeded> {
  const userId = newUlid();
  const tail = userId.toLowerCase();
  const email = `Runner_${tail}@Example.TEST`;
  const handle = `runner_${tail.slice(-10)}`;
  const at = new Date(NOW * 1000);
  const runIds = [newUlid(), newUlid()];
  const entryId = newUlid();
  const photoId = newUlid();
  const garmentIds = [newUlid(), newUlid()];
  const screeningIds = [newUlid(), newUlid()];
  const looseUploadKey = `imports/${userId}/${newUlid()}.gpx`;
  const runUploadKey = `imports/${userId}/${newUlid()}.fit`;
  const redeemedAs = firstAddress(email);
  await core.batch([
    core.insert(user).values({
      id: userId,
      name: "Runner",
      email,
      emailVerified: true,
      createdAt: at,
      updatedAt: at,
    }),
    core.insert(session).values({
      id: newUlid(),
      userId,
      token: newUlid(),
      expiresAt: at,
      createdAt: at,
      updatedAt: at,
    }),
    core.insert(account).values({
      id: newUlid(),
      userId,
      issuer: "credential",
      accountId: userId,
      providerId: "credential",
      password: "hash",
      createdAt: at,
      updatedAt: at,
    }),
    core.insert(userProfiles).values({ userId, username: handle }),
    core.insert(runs).values(
      runIds.map((id, n) => ({
        id,
        userId,
        source: "manual" as const,
        startedAt: NOW - 86_400 * (n + 1),
        durationS: 1800,
        distanceM: 5000,
        title: "Morning run",
      })),
    ),
    core.insert(outfitEntries).values({
      id: entryId,
      runId: runIds[0] ?? "",
      userId,
      verdict: 0,
      ...entryAudienceColumns("runners"),
      createdAt: NOW,
    }),
    core.insert(wardrobeItems).values([
      {
        id: garmentIds[0] ?? "",
        userId,
        category: "top",
        name: "Singlet",
        photoKey: `items/${userId}/${garmentIds[0] ?? ""}/photo.webp`,
        createdAt: NOW,
      },
      {
        id: garmentIds[1] ?? "",
        userId,
        category: "shoes",
        name: "Trainers",
        createdAt: NOW,
      },
    ]),
    core
      .insert(outfitEntryItems)
      .values({ entryId, itemId: garmentIds[0] ?? "", flag: "too_much" }),
    core.insert(entryTags).values({ entryId, tag: "windy" }),
    core.insert(entryPhotos).values({
      id: photoId,
      entryId,
      photoKey: `entries/${userId}/${entryId}/${photoId}.webp`,
      position: 0,
      screenStatus: "pass",
    }),
    core.insert(photoScreenings).values([
      {
        id: screeningIds[0] ?? "",
        photoScope: "entry",
        photoId,
        model: "m",
        scores: "{}",
        decision: "pass",
        createdAt: NOW,
      },
      {
        id: screeningIds[1] ?? "",
        photoScope: "garment",
        photoId: garmentIds[0] ?? "",
        model: "m",
        scores: "{}",
        decision: "pass",
        createdAt: NOW,
      },
    ]),
    core.insert(notifications).values([
      {
        id: newUlid(),
        userId,
        kind: "verdict_prompt",
        subjectId: entryId,
        body: "How was it?",
        createdAt: NOW,
      },
      {
        // Names nothing a run or an entry does: only the account's own
        // delete can reach it.
        id: newUlid(),
        userId,
        kind: "import_failed",
        subjectId: newUlid(),
        body: "Your import failed.",
        createdAt: NOW,
      },
    ]),
    core.insert(notificationPreferences).values({
      userId,
      kind: "run_reminder",
      email: false,
      updatedAt: NOW,
    }),
    core.insert(emailVerifications).values([
      {
        userId,
        purpose: "verify",
        email,
        tokenHash: "hash",
        expiresAt: NOW + 3600,
      },
      // An email change still open: the address it moves to.
      {
        userId,
        purpose: "change",
        email: movingTo(email),
        tokenHash: "hash-2",
        expiresAt: NOW + 3600,
      },
    ]),
    // An open reset link, which Better Auth keys by its token and names
    // the runner in `value`.
    core.insert(verification).values({
      id: newUlid(),
      identifier: `reset-password:${newUlid()}`,
      value: userId,
      expiresAt: new Date((NOW + 3600) * 1000),
      createdAt: new Date(NOW * 1000),
      updatedAt: new Date(NOW * 1000),
    }),
    core
      .insert(passwordAttempts)
      .values({ userId, windowStartedAt: NOW, attempts: 2 }),
    // An access request under every address they are known by.
    core.insert(accessRequests).values(
      [email, redeemedAs, movingTo(email)].map((address) => ({
        id: newUlid(),
        email: address.toLowerCase(),
        createdAt: NOW,
        updatedAt: NOW,
      })),
    ),
    // Invite codes whose label names them: one written before D7 stopped
    // copying a request's address onto its code, and one an operator
    // typed, in the address's own mixed case.
    core.insert(inviteCodes).values([
      {
        id: newUlid(),
        code: `DIAL-${tail.slice(-4)}`,
        label: `${redeemedAs} (request)`,
        createdAt: NOW,
      },
      {
        id: newUlid(),
        code: `DIAL-${tail.slice(-8, -4)}`,
        label: `Club night, ${email}`,
        createdAt: NOW,
      },
    ]),
    core.insert(emailSendLimits).values(
      limitKeysOf(email).map((key) => ({
        key,
        windowStartedAt: NOW,
        sends: 1,
      })),
    ),
    core.insert(inviteRedemptions).values({
      userId,
      codeId: newUlid(),
      email: redeemedAs,
      heldUntil: NOW,
      redeemedAt: NOW,
      confirmedAt: NOW,
    }),
    core.insert(imports).values([
      {
        // An upload that never became a run.
        id: newUlid(),
        userId,
        r2Key: looseUploadKey,
        status: "failed",
        createdAt: NOW,
      },
      {
        // One that did: its run's delete takes it.
        id: newUlid(),
        userId,
        r2Key: runUploadKey,
        status: "done",
        runId: runIds[1] ?? "",
        createdAt: NOW,
      },
    ]),
    core.insert(stravaConnections).values({
      userId,
      athleteId: newUlid(),
      refreshToken: `refresh-${userId}`,
      connectedAt: NOW,
    }),
  ]);
  await weather
    .insert(manualConditions)
    .values({ runId: runIds[0] ?? "", tempC: 4, setAt: NOW, sky: "dry" });
  // What R2 holds for them: a garment photo's sizes, an entry photo, and
  // both uploads' files.
  for (const key of [
    `items/${userId}/${garmentIds[0] ?? ""}/photo.webp/card.webp`,
    `items/${userId}/${garmentIds[0] ?? ""}/photo.webp/full.webp`,
    `entries/${userId}/${entryId}/${photoId}.webp`,
  ]) {
    await env.MEDIA.put(key, "bytes");
  }
  for (const key of [looseUploadKey, runUploadKey]) {
    await env.IMPORTS.put(key, "bytes");
  }
  // The terms they accepted (ACC-6), two versions of them.
  await core.insert(termsAcceptances).values([
    { userId, version: 1, acceptedAt: NOW - 120 },
    { userId, version: 2, acceptedAt: NOW - 60 },
  ]);
  // A data export (ACC-10): one ready, with its ZIP, and one ZIP a build
  // staged with no row to name it — the purge lists the prefix for both.
  const exportId = newUlid();
  await core.insert(dataExports).values({
    id: exportId,
    userId,
    idempotencyKey: newUlid(),
    linkToken: newUlid().toLowerCase(),
    status: "ready",
    requestedAt: NOW - 60,
    readyAt: NOW - 30,
    expiresAt: NOW + 86_400,
  });
  for (const key of [
    `exports/${userId}/${exportId}.zip`,
    `exports/${userId}/${newUlid()}.zip`,
  ]) {
    await env.IMPORTS.put(key, "zip");
  }
  return {
    userId,
    email,
    handle,
    redeemedAs,
    runIds,
    entryId,
    garmentIds,
    screeningIds,
    looseUploadKey,
  };
}

function byKey(a: { dedupeKey: string }, b: { dedupeKey: string }): number {
  return a.dedupeKey.localeCompare(b.dedupeKey);
}

function byText(a: string, b: string): number {
  return a.localeCompare(b);
}

function sendLimitKeys(email: string): string[] {
  const address = email.toLowerCase();
  return [`verify:${address}`, `reset:${address}`, `change:${address}`];
}

/**
The address a seeded runner's open email change moves to.
*/
function movingTo(email: string): string {
  return `moving-${email}`;
}

/**
The address a seeded runner redeemed their invite with, lower-cased.
*/
function firstAddress(email: string): string {
  return `first-${email.toLowerCase()}`;
}

/**
Every address a seeded runner is known by, lower-cased.
*/
function addressesOf(email: string): string[] {
  return [email, firstAddress(email), movingTo(email)].map((address) =>
    address.toLowerCase(),
  );
}

/**
Every counter a seeded runner's addresses hold.
*/
function limitKeysOf(email: string): string[] {
  return addressesOf(email).flatMap((address) => sendLimitKeys(address));
}

/**
 * What R2 still holds under the runner's prefixes — the garment photos',
 * the entry photos' and the uploads' — once the outbox's R2 debts have
 * been drained, as the daily firing drains them.
 */
async function r2Left(userId: string): Promise<string[]> {
  await drainOutbox(core, [], {
    now: nowSeconds() + 86_400,
    kinds: ["photo_delete", "entry_media_delete", "import_file_delete"],
    report: () => {
      // a debt that fails stays owed, and its object shows below
    },
  });
  return r2Keys(userId);
}

async function r2Keys(userId: string): Promise<string[]> {
  const pages = [
    await env.MEDIA.list({ prefix: `items/${userId}/` }),
    await env.MEDIA.list({ prefix: `entries/${userId}/` }),
    await env.IMPORTS.list({ prefix: `imports/${userId}/` }),
    await env.IMPORTS.list({ prefix: `exports/${userId}/` }),
  ];
  return pages.flatMap((page) => page.objects.map((object) => object.key));
}

async function claim(
  userId: string,
  purgeAfter: number,
  purgeStartedAt?: number,
): Promise<void> {
  await core.insert(accountDeletions).values({
    userId,
    requestedAt: purgeAfter - 7 * 86_400,
    purgeAfter,
    purgeStartedAt,
  });
}

async function claimOf(userId: string) {
  return core
    .select()
    .from(accountDeletions)
    .where(eq(accountDeletions.userId, userId));
}

/**
 * Every row of every table that names this account — both databases.
 * Reports and invite redemptions are left out: the purge keeps those,
 * rewritten, and each test checks them by name.
 */
async function footprint(seeded: Seeded) {
  const { userId } = seeded;
  return {
    user: await core.select().from(user).where(eq(user.id, userId)),
    session: await core
      .select()
      .from(session)
      .where(eq(session.userId, userId)),
    account: await core
      .select()
      .from(account)
      .where(eq(account.userId, userId)),
    profile: await core
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId)),
    runs: await core.select().from(runs).where(eq(runs.userId, userId)),
    manualConditions: await weather
      .select()
      .from(manualConditions)
      .where(inArray(manualConditions.runId, [...seeded.runIds])),
    entries: await core
      .select()
      .from(outfitEntries)
      .where(eq(outfitEntries.userId, userId)),
    entryItems: await core
      .select()
      .from(outfitEntryItems)
      .where(eq(outfitEntryItems.entryId, seeded.entryId)),
    entryTags: await core
      .select()
      .from(entryTags)
      .where(eq(entryTags.entryId, seeded.entryId)),
    entryPhotos: await core
      .select()
      .from(entryPhotos)
      .where(eq(entryPhotos.entryId, seeded.entryId)),
    screenings: await core
      .select()
      .from(photoScreenings)
      .where(inArray(photoScreenings.id, [...seeded.screeningIds])),
    reactions: await core
      .select()
      .from(reactions)
      .where(
        or(eq(reactions.entryId, seeded.entryId), eq(reactions.userId, userId)),
      ),
    follows: await core
      .select()
      .from(follows)
      .where(
        or(eq(follows.followerId, userId), eq(follows.followeeId, userId)),
      ),
    blocks: await core
      .select()
      .from(blocks)
      .where(or(eq(blocks.blockerId, userId), eq(blocks.blockedId, userId))),
    notifications: await core
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId)),
    preferences: await core
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId)),
    verifications: await core
      .select()
      .from(emailVerifications)
      .where(eq(emailVerifications.userId, userId)),
    passwordAttempts: await core
      .select()
      .from(passwordAttempts)
      .where(eq(passwordAttempts.userId, userId)),
    accessRequests: await core
      .select()
      .from(accessRequests)
      .where(inArray(accessRequests.email, addressesOf(seeded.email))),
    inviteLabels: await core
      .select({ label: inviteCodes.label })
      .from(inviteCodes)
      .where(
        or(
          ...addressesOf(seeded.email).map(
            (address) =>
              sql`instr(lower(${inviteCodes.label}), ${address}) > 0`,
          ),
        ),
      ),
    sendLimits: await core
      .select()
      .from(emailSendLimits)
      .where(inArray(emailSendLimits.key, limitKeysOf(seeded.email))),
    resetLinks: await core
      .select()
      .from(verification)
      .where(eq(verification.value, userId)),
    garments: await core
      .select()
      .from(wardrobeItems)
      .where(eq(wardrobeItems.userId, userId)),
    imports: await core
      .select()
      .from(imports)
      .where(eq(imports.userId, userId)),
    strava: await core
      .select()
      .from(stravaConnections)
      .where(eq(stravaConnections.userId, userId)),
    exports: await core
      .select()
      .from(dataExports)
      .where(eq(dataExports.userId, userId)),
    terms: await core
      .select()
      .from(termsAcceptances)
      .where(eq(termsAcceptances.userId, userId)),
    claim: await claimOf(userId),
  };
}

const GONE = {
  user: [],
  session: [],
  account: [],
  profile: [],
  runs: [],
  manualConditions: [],
  entries: [],
  entryItems: [],
  entryTags: [],
  entryPhotos: [],
  screenings: [],
  reactions: [],
  follows: [],
  blocks: [],
  notifications: [],
  preferences: [],
  verifications: [],
  passwordAttempts: [],
  accessRequests: [],
  inviteLabels: [],
  sendLimits: [],
  resetLinks: [],
  garments: [],
  imports: [],
  strava: [],
  exports: [],
  terms: [],
  claim: [],
};

async function hasProfile(userId: string): Promise<boolean> {
  const rows = await core
    .select({ userId: userProfiles.userId })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId));
  return rows.length === 1;
}

/**
A runner the claim tests only need to find again: a profile and a claim.
*/
async function claimedProfile(
  purgeAfter: number,
  purgeStartedAt?: number,
): Promise<string> {
  const userId = newUlid();
  await core.insert(userProfiles).values({ userId });
  await claim(userId, purgeAfter, purgeStartedAt);
  return userId;
}

beforeEach(async () => {
  // The firing claims every due row in the table, and counts what is left:
  // a claim leaked from another test would be purged, or counted, here.
  await core.delete(accountDeletions);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the purge's limits", () => {
  it("purges at most three accounts a firing, and holds a claim for an hour", () => {
    expect(PURGE_PER_FIRING).toBe(3);
    expect(PURGE_LEASE_S).toBe(3600);
  });
});

describe("purgeDueAccounts — a full purge", () => {
  it("leaves nothing of the runner's in either database, and nothing of anyone else's changed", async () => {
    const runner = await seedAccount();
    const other = await seedAccount();
    const third = newUlid();

    // Other's rows with a third runner: none of this is the runner's.
    await core.batch([
      core.insert(follows).values({
        followerId: other.userId,
        followeeId: third,
        createdAt: NOW,
      }),
      core
        .insert(blocks)
        .values({ blockerId: other.userId, blockedId: third, createdAt: NOW }),
      core
        .insert(reactions)
        .values({ entryId: other.entryId, userId: third, createdAt: NOW }),
    ]);
    const otherBefore = await footprint(other);

    // Everything between the two of them, in both directions.
    const filedByRunner = newUlid();
    const filedAboutRunner = newUlid();
    const profileReview = newUlid();
    const othersReview = newUlid();
    await core.batch([
      core.insert(reactions).values({
        entryId: other.entryId,
        userId: runner.userId,
        createdAt: NOW,
      }),
      core.insert(reactions).values({
        entryId: runner.entryId,
        userId: other.userId,
        createdAt: NOW,
      }),
      core.insert(follows).values([
        { followerId: runner.userId, followeeId: other.userId, createdAt: NOW },
        { followerId: other.userId, followeeId: runner.userId, createdAt: NOW },
      ]),
      core.insert(blocks).values([
        { blockerId: runner.userId, blockedId: other.userId, createdAt: NOW },
        { blockerId: other.userId, blockedId: runner.userId, createdAt: NOW },
      ]),
      core.insert(reports).values([
        {
          id: filedByRunner,
          reporterId: runner.userId,
          subjectType: "entry",
          subjectId: other.entryId,
          reason: "spam",
          createdAt: NOW,
        },
        {
          id: filedAboutRunner,
          reporterId: other.userId,
          subjectType: "profile",
          subjectId: runner.userId,
          reason: "harassment",
          createdAt: NOW,
        },
      ]),
      core.insert(reviewQueue).values([
        {
          id: profileReview,
          subjectType: "profile",
          subjectId: runner.userId,
          source: "reports",
          status: "pending",
          createdAt: NOW,
        },
        {
          id: othersReview,
          subjectType: "profile",
          subjectId: other.userId,
          source: "reports",
          status: "pending",
          createdAt: NOW,
        },
      ]),
      core.insert(emailSendLimits).values({
        key: `access:1.2.3.4-${runner.userId}`,
        windowStartedAt: NOW,
        sends: 1,
      }),
    ]);
    await claim(runner.userId, NOW - 1);
    const { deps, revoked, reported } = depsAt(NOW);
    const anomalies: string[] = [];

    await purgeDueAccounts(anomalies, deps);

    expect(await footprint(runner)).toStrictEqual(GONE);
    expect(await footprint(other)).toStrictEqual(otherBefore);
    expect(revoked).toStrictEqual([runner.userId]);
    expect(reported).toStrictEqual([]);
    expect(anomalies).toStrictEqual([]);

    // The report they filed stays, naming nobody — by its own id, so two
    // such reports stay distinct.
    const [theirs] = await core
      .select({ reporterId: reports.reporterId })
      .from(reports)
      .where(eq(reports.id, filedByRunner));
    expect(theirs?.reporterId).toBe(`deleted:${filedByRunner}`);
    // The report about them stays as it was.
    const [aboutThem] = await core
      .select()
      .from(reports)
      .where(eq(reports.id, filedAboutRunner));
    expect(aboutThem).toMatchObject({
      reporterId: other.userId,
      subjectId: runner.userId,
    });

    // Their profile's open review is settled as removed, by them; other's
    // is untouched.
    const [review] = await core
      .select()
      .from(reviewQueue)
      .where(eq(reviewQueue.id, profileReview));
    expect(review).toMatchObject({
      status: "removed",
      resolvedBy: runner.userId,
    });
    expect(review?.claimedAt).toBeNull();
    const [othersQueued] = await core
      .select()
      .from(reviewQueue)
      .where(eq(reviewQueue.id, othersReview));
    expect(othersQueued?.status).toBe("pending");
    expect(othersQueued?.resolvedBy).toBeNull();

    // The invite's use stays spent, without the address.
    const redemptions = await core
      .select({
        userId: inviteRedemptions.userId,
        email: inviteRedemptions.email,
      })
      .from(inviteRedemptions)
      .where(inArray(inviteRedemptions.userId, [runner.userId, other.userId]));
    expect(
      redemptions.toSorted((a, b) => a.userId.localeCompare(b.userId)),
    ).toStrictEqual(
      [
        { userId: runner.userId, email: `deleted:${runner.userId}` },
        { userId: other.userId, email: other.redeemedAs },
      ].toSorted((a, b) => a.userId.localeCompare(b.userId)),
    );

    // The handle is never released.
    const history = await core
      .select()
      .from(usernameHistory)
      .where(eq(usernameHistory.username, runner.handle));
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      username: runner.handle,
      userId: runner.userId,
      retiredAt: NOW,
    });
    // Retired, not locked: a moderator's lock is a different fact.
    expect(history[0]?.lockedAt).toBeNull();

    // A limit counted by address other than theirs is kept.
    const access = await core
      .select({ key: emailSendLimits.key })
      .from(emailSendLimits)
      .where(eq(emailSendLimits.key, `access:1.2.3.4-${runner.userId}`));
    expect(access).toHaveLength(1);

    // What R2 is owed: each garment's photos and the upload that never
    // became a run. The entries' prefix and the run's upload were settled
    // by feed's fast path.
    const owed = await core
      .select({ kind: outbox.kind, dedupeKey: outbox.dedupeKey })
      .from(outbox)
      .where(like(outbox.dedupeKey, `${runner.userId}:%`));
    expect(owed.toSorted(byKey)).toStrictEqual(
      [
        ...runner.garmentIds.map((itemId) => ({
          kind: "photo_delete",
          dedupeKey: `${runner.userId}:${itemId}`,
        })),
        {
          kind: "import_file_delete",
          dedupeKey: `${runner.userId}:${runner.looseUploadKey}`,
        },
      ].toSorted(byKey),
    );
    const otherOwes = await core
      .select({ id: outbox.id })
      .from(outbox)
      .where(like(outbox.dedupeKey, `${other.userId}:%`));
    expect(otherOwes).toStrictEqual([]);

    // And once those are paid, R2 holds nothing of theirs — and all of
    // the other runner's.
    const otherObjects = await r2Keys(other.userId);
    expect(otherObjects).toHaveLength(7);
    expect(await r2Left(runner.userId)).toStrictEqual([]);
    expect(await r2Keys(other.userId)).toStrictEqual(otherObjects);
    // The codes that named them are kept, labelled by nothing.
    const codes = await core
      .select({ label: inviteCodes.label })
      .from(inviteCodes)
      .where(
        inArray(inviteCodes.code, [
          `DIAL-${runner.userId.toLowerCase().slice(-4)}`,
          `DIAL-${runner.userId.toLowerCase().slice(-8, -4)}`,
        ]),
      );
    expect(codes).toHaveLength(2);
    for (const code of codes) expect(code.label).toBeNull();
  });

  it("writes no retired handle for a runner who never chose one", async () => {
    const runner = await seedAccount();
    await core
      .update(userProfiles)
      .set({ username: orSqlNull(undefined) })
      .where(eq(userProfiles.userId, runner.userId));
    await claim(runner.userId, NOW - 1);

    await purgeDueAccounts([], depsAt(NOW).deps);

    expect(await footprint(runner)).toStrictEqual(GONE);
    const history = await core
      .select()
      .from(usernameHistory)
      .where(eq(usernameHistory.userId, runner.userId));
    expect(history).toStrictEqual([]);
  });

  it("finishes a claim whose account rows are already gone", async () => {
    const userId = newUlid();
    await core.insert(follows).values({
      followerId: userId,
      followeeId: newUlid(),
      createdAt: NOW,
    });
    await claim(userId, NOW - 1);
    const { deps, revoked, reported } = depsAt(NOW);
    const anomalies: string[] = [];

    await purgeDueAccounts(anomalies, deps);

    expect(await claimOf(userId)).toStrictEqual([]);
    expect(
      await core.select().from(follows).where(eq(follows.followerId, userId)),
    ).toStrictEqual([]);
    expect(revoked).toStrictEqual([userId]);
    expect(reported).toStrictEqual([]);
    expect(anomalies).toStrictEqual([]);
    expect(
      await core
        .select()
        .from(usernameHistory)
        .where(eq(usernameHistory.userId, userId)),
    ).toStrictEqual([]);
  });
});

describe("purgeDueAccounts — which claims a firing takes", () => {
  it("leaves a claim that is not yet due, and everything of its runner's", async () => {
    const runner = await seedAccount();
    await claim(runner.userId, NOW + 1);
    const before = await footprint(runner);
    const { deps, revoked } = depsAt(NOW);
    const anomalies: string[] = [];

    await purgeDueAccounts(anomalies, deps);

    expect(await footprint(runner)).toStrictEqual(before);
    expect(revoked).toStrictEqual([]);
    expect(anomalies).toStrictEqual([]);
  });

  it("takes a claim due this very second", async () => {
    const userId = await claimedProfile(NOW);

    await purgeDueAccounts([], depsAt(NOW).deps);

    expect(await hasProfile(userId)).toBe(false);
    expect(await claimOf(userId)).toStrictEqual([]);
  });

  it("skips a claim another firing still holds, and does not count it as waiting", async () => {
    const tenMinutesAgo = await claimedProfile(NOW - 86_400, NOW - 600);
    const leaseEdge = await claimedProfile(NOW - 86_400, NOW - PURGE_LEASE_S);
    const { deps, revoked } = depsAt(NOW);
    const anomalies: string[] = [];

    await purgeDueAccounts(anomalies, deps);

    expect(revoked).toStrictEqual([]);
    expect(anomalies).toStrictEqual([]);
    expect(await hasProfile(tenMinutesAgo)).toBe(true);
    expect(await hasProfile(leaseEdge)).toBe(true);
    expect(await claimOf(tenMinutesAgo)).toStrictEqual([
      {
        userId: tenMinutesAgo,
        requestedAt: NOW - 8 * 86_400,
        purgeAfter: NOW - 86_400,
        purgeStartedAt: NOW - 600,
      },
    ]);
  });

  it("retakes a claim whose purge has held it past the lease", async () => {
    const userId = await claimedProfile(NOW - 86_400, NOW - PURGE_LEASE_S - 1);
    const { deps, revoked } = depsAt(NOW);

    await purgeDueAccounts([], deps);

    expect(revoked).toStrictEqual([userId]);
    expect(await hasProfile(userId)).toBe(false);
    expect(await claimOf(userId)).toStrictEqual([]);
  });

  it("purges the oldest three due, and says how many wait for the next firing", async () => {
    // Inserted out of order, so the order is the query's and not the table's.
    const ages = [5, 1, 4, 2, 3];
    const byAge = new Map<number, string>();
    for (const age of ages) {
      byAge.set(age, await claimedProfile(NOW - age * 60));
    }
    const { deps, revoked } = depsAt(NOW);
    const anomalies: string[] = [];

    await purgeDueAccounts(anomalies, deps);

    const oldest = [5, 4, 3].map((age) => byAge.get(age) ?? "");
    const newest = [2, 1].map((age) => byAge.get(age) ?? "");
    expect(revoked.toSorted(byText)).toStrictEqual(oldest.toSorted(byText));
    expect(anomalies).toStrictEqual([
      "2 account deletion(s) past their date wait for the next firing",
    ]);
    for (const userId of oldest) {
      expect(await hasProfile(userId)).toBe(false);
    }
    for (const userId of newest) {
      expect(await hasProfile(userId)).toBe(true);
      const [waiting] = await claimOf(userId);
      // Not claimed: the next firing takes it without waiting out a lease.
      expect(waiting?.purgeStartedAt).toBeNull();
    }

    const next = depsAt(NOW + 86_400);
    const nextAnomalies: string[] = [];
    await purgeDueAccounts(nextAnomalies, next.deps);

    expect(next.revoked.toSorted(byText)).toStrictEqual(
      newest.toSorted(byText),
    );
    expect(nextAnomalies).toStrictEqual([]);
  });
});

describe("purgeDueAccounts — a purge that stops part way", () => {
  it("reports it, keeps the claim, and the next firing finishes it", async () => {
    const runner = await seedAccount();
    const bystander = await claimedProfile(NOW - 1);
    await claim(runner.userId, NOW - 1);
    const first = depsAt(NOW, [runner.userId]);
    const anomalies: string[] = [];

    await purgeDueAccounts(anomalies, first.deps);

    expect(first.reported).toStrictEqual([
      {
        error: new Error("Strava is down"),
        context: { surface: "account-purge", userId: runner.userId },
      },
    ]);
    expect(anomalies).toStrictEqual([
      "1 account deletion(s) stopped part way and are finished on the next firing",
    ]);
    const [held] = await claimOf(runner.userId);
    expect(held?.purgeStartedAt).toBe(NOW);
    expect(await hasProfile(runner.userId)).toBe(true);
    // One runner's failure does not stop the firing: the other is purged.
    expect(await hasProfile(bystander)).toBe(false);

    // Inside the lease, a second firing leaves it alone.
    const overlapping = depsAt(NOW + 60);
    await purgeDueAccounts([], overlapping.deps);
    expect(overlapping.revoked).toStrictEqual([]);

    const next = depsAt(NOW + PURGE_LEASE_S + 1);
    const nextAnomalies: string[] = [];
    await purgeDueAccounts(nextAnomalies, next.deps);

    expect(next.revoked).toStrictEqual([runner.userId]);
    expect(next.reported).toStrictEqual([]);
    expect(nextAnomalies).toStrictEqual([]);
    expect(await footprint(runner)).toStrictEqual(GONE);
  });
});

/**
 * Makes the purge's `n`th `core.batch` fail, once — counted from the
 * firing's first, which is the claim.
 */
function failBatch(n: number): void {
  const batch = core.batch.bind(core);
  let batches = 0;
  vi.spyOn(core, "batch").mockImplementation((queries) => {
    batches += 1;
    return batches === n
      ? Promise.reject(new Error("D1 is down"))
      : batch(queries);
  });
}

type Footprint = Awaited<ReturnType<typeof footprint>>;

/**
 * Each of `purgeAccount`'s six steps, stopped in turn: how to stop it,
 * and what the rows say about where it stopped — the step before it done,
 * its own not — so each case proves it interrupted the step it names.
 */
const STEPS: readonly {
  readonly step: string;
  readonly stop: (runner: Seeded) => Recorded;
  readonly stoppedAt: (partial: Footprint, revoked: readonly string[]) => void;
}[] = [
  {
    step: "1 · the runner's bands in DIALED_WEATHER",
    stop: () => {
      vi.spyOn(weather, "delete").mockImplementationOnce(() => {
        throw new Error("DIALED_WEATHER is down");
      });
      return depsAt(NOW);
    },
    stoppedAt: (partial, revoked) => {
      expect(partial.manualConditions).toHaveLength(1);
      expect(revoked).toStrictEqual([]);
    },
  },
  {
    step: "2 · the Strava grant",
    stop: (runner) => depsAt(NOW, [runner.userId]),
    stoppedAt: (partial, revoked) => {
      expect(partial.manualConditions).toStrictEqual([]);
      expect(revoked).toHaveLength(1);
      expect(partial.screenings).toHaveLength(2);
    },
  },
  {
    step: "3 · the photo screenings",
    stop: () => {
      failBatch(2);
      return depsAt(NOW);
    },
    stoppedAt: (partial, revoked) => {
      expect(revoked).toHaveLength(1);
      expect(partial.screenings).toHaveLength(2);
      expect(partial.runs).toHaveLength(2);
    },
  },
  {
    step: "4 · the runs and entries",
    stop: () => {
      failBatch(3);
      return depsAt(NOW);
    },
    stoppedAt: (partial) => {
      expect(partial.screenings).toStrictEqual([]);
      expect(partial.runs).toHaveLength(2);
      expect(partial.garments).toHaveLength(2);
    },
  },
  {
    step: "5 · the closet",
    stop: () => {
      failBatch(4);
      return depsAt(NOW);
    },
    stoppedAt: (partial) => {
      expect(partial.runs).toStrictEqual([]);
      expect(partial.garments).toHaveLength(2);
      expect(partial.user).toHaveLength(1);
    },
  },
  {
    step: "6 · the account itself",
    stop: () => {
      // Its last batch: the fifth reads the runner's addresses.
      failBatch(6);
      return depsAt(NOW);
    },
    stoppedAt: (partial) => {
      expect(partial.garments).toStrictEqual([]);
      expect(partial.imports).toStrictEqual([]);
      // The account and its claim did not go, so a claim that exists is
      // still a purge owed.
      expect(partial.user).toHaveLength(1);
      expect(partial.claim).toHaveLength(1);
    },
  },
];

describe("purgeDueAccounts — a purge stopped at any step", () => {
  it.each(STEPS)(
    "is finished by the next firing when it stops at $step",
    async ({ stop, stoppedAt }) => {
      const runner = await seedAccount();
      await claim(runner.userId, NOW - 1);
      const first = stop(runner);
      const anomalies: string[] = [];

      await purgeDueAccounts(anomalies, first.deps);
      vi.restoreAllMocks();

      expect(first.reported).toHaveLength(1);
      expect(anomalies).toStrictEqual([
        "1 account deletion(s) stopped part way and are finished on the next firing",
      ]);
      stoppedAt(await footprint(runner), first.revoked);

      const next = depsAt(NOW + PURGE_LEASE_S + 1);
      const nextAnomalies: string[] = [];
      await purgeDueAccounts(nextAnomalies, next.deps);

      expect(next.reported).toStrictEqual([]);
      expect(nextAnomalies).toStrictEqual([]);
      expect(await footprint(runner)).toStrictEqual(GONE);
      expect(await r2Left(runner.userId)).toStrictEqual([]);
    },
  );
});

describe("purgeDueAccounts — nobody signs in behind the purge", () => {
  it("signs out a runner the moment their purge starts, even one that stops, and leaves a runner still inside the week signed in", async () => {
    const runner = await seedAccount();
    const inTheWeek = await seedAccount();
    await claim(runner.userId, NOW - 1);
    await claim(inTheWeek.userId, NOW + 86_400);
    // Stopped at its first step: the sign-out is the claim's, not a step's.
    vi.spyOn(weather, "delete").mockImplementationOnce(() => {
      throw new Error("DIALED_WEATHER is down");
    });

    await purgeDueAccounts([], depsAt(NOW).deps);

    const partial = await footprint(runner);
    expect(partial.session).toStrictEqual([]);
    expect(partial.claim[0]?.purgeStartedAt).toBe(NOW);
    expect(partial.user).toHaveLength(1);
    const stillInTheWeek = await footprint(inTheWeek);
    expect(stillInTheWeek.session).toHaveLength(1);
  });

  it("signs out the runner of a purge another firing already holds", async () => {
    const runner = await seedAccount();
    // Held by a firing ten minutes ago, which this one leaves alone.
    await claim(runner.userId, NOW - 86_400, NOW - 600);
    const { deps, revoked } = depsAt(NOW);

    await purgeDueAccounts([], deps);

    expect(revoked).toStrictEqual([]);
    const held = await footprint(runner);
    expect(held.session).toStrictEqual([]);
  });
});

describe("purgeDueAccounts — the Worker's own wiring", () => {
  it("revokes the Strava grant through the runs module, owed and queued", async () => {
    const runner = await seedAccount();
    await claim(runner.userId, nowSeconds() - 1);
    const send = vi.spyOn(env.IMPORTS_QUEUE, "send");
    const anomalies: string[] = [];

    await purgeDueAccounts(anomalies);

    expect(await footprint(runner)).toStrictEqual(GONE);
    const owed = await core
      .select({ id: stravaRevocations.id })
      .from(stravaRevocations)
      .where(eq(stravaRevocations.refreshToken, `refresh-${runner.userId}`));
    expect(owed).toHaveLength(1);
    expect(send).toHaveBeenCalledWith({
      type: "strava_revoke",
      revocationId: owed[0]?.id,
    });
    expect(anomalies).toStrictEqual([]);
  });
});

describe("purgeAccount", () => {
  it("keeps a retired handle's first owner when the handle is already history", async () => {
    const runner = await seedAccount();
    const firstOwner = newUlid();
    await core.insert(usernameHistory).values({
      username: runner.handle,
      userId: firstOwner,
      retiredAt: NOW - 86_400,
    });
    await claim(runner.userId, NOW - 1);

    await purgeAccount(depsAt(NOW).deps, runner.userId);

    expect(await footprint(runner)).toStrictEqual(GONE);
    const history = await core
      .select({
        userId: usernameHistory.userId,
        retiredAt: usernameHistory.retiredAt,
      })
      .from(usernameHistory)
      .where(eq(usernameHistory.username, runner.handle));
    expect(history).toStrictEqual([
      { userId: firstOwner, retiredAt: NOW - 86_400 },
    ]);
  });

  it("is a no-op the second time", async () => {
    const runner = await seedAccount();
    await claim(runner.userId, NOW - 1);
    const { deps } = depsAt(NOW);

    await purgeAccount(deps, runner.userId);
    await purgeAccount(deps, runner.userId);

    expect(await footprint(runner)).toStrictEqual(GONE);
    const owed = await core
      .select({ kind: outbox.kind })
      .from(outbox)
      .where(
        and(
          like(outbox.dedupeKey, `${runner.userId}:%`),
          eq(outbox.kind, "photo_delete"),
        ),
      );
    expect(owed).toHaveLength(2);
  });
});
