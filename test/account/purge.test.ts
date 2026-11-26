import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { countRow, countedKeys } from "../rate-limit-rows";

import { account, session, user, verification } from "../../src/db/schema-auth";
import {
  accessAsks,
  accessRequests,
  accountDeletions,
  blocks,
  closedAddresses,
  copyrightHolds,
  dataExports,
  rateLimits,
  emailVerifications,
  entryPhotos,
  entryTags,
  follows,
  followNotices,
  heldTakeDowns,
  productCorrections,
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
  reminderEmailDays,
  reports,
  reviewQueue,
  runConditions,
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
  PURGE_BUDGET_MS,
  PURGE_LEASE_S,
  PURGE_PER_ROUND,
  purgeAccount,
  purgeDueAccounts,
} from "../../src/modules/account/purge/purge";
import type { PurgeDeps } from "../../src/modules/account/purge/purge";
import {
  CLOSED_ADDRESS_KEPT_S,
  closedAddressHash,
} from "../../src/modules/account/access/closed-addresses";
import { forgetManualBands } from "../../src/modules/weather";
import { drainOutbox } from "../../src/modules/ops/outbox/outbox";
import { ONLY_THEIRS_GONE, seedAthleteGaveUp } from "../gave-up-rows";
import { outboxHandlers as registryWith } from "../../src/modules/dispatch/outbox-handlers";

/**
The drains' registry, as production assembles it (no linker).
*/
const outboxHandlers = registryWith(undefined);

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
 * Strava revoke throw for those runners, once each; `isBandStepDown` makes the
 * band step throw, as `DIALED_WEATHER` being unreachable would.
 */
function depsAt(
  now: number,
  failFor: readonly string[] = [],
  isBandStepDown = false,
): Recorded {
  const revoked: string[] = [];
  const reported: Recorded["reported"] = [];
  const pending = new Set(failFor);
  return {
    revoked,
    reported,
    deps: {
      core,
      forgetBands: (runIds) =>
        isBandStepDown
          ? Promise.reject(new Error("DIALED_WEATHER is down"))
          : forgetManualBands(runIds),
      now,
      revokeStrava: (userId) => {
        revoked.push(userId);
        return pending.delete(userId)
          ? Promise.reject(new Error("Strava is down"))
          : Promise.resolve();
      },
      importsBucket: env.IMPORTS,
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
  /**
  Every run file of theirs in `IMPORTS`, named by a row or not.
  */
  readonly uploadKeys: readonly string[];
}

/**
 * One runner with a row of every kind an account accumulates on its own —
 * everything that names only them. Rows between two runners are seeded by
 * the test, after the "before" snapshot.
 */
/**
The copy of the first run's conditions the consensus reads (D-175).
*/
function conditionsCopy(runIds: readonly string[], userId: string) {
  return core.insert(runConditions).values({
    runId: runIds[0] ?? "",
    userId,
    feelsLikeC: 4,
    minFeelsLikeC: 4,
    maxFeelsLikeC: 4,
    precipClass: "dry",
    source: "visualcrossing",
    verdict: 0,
    entryCreatedAt: NOW,
    entryShared: true,
  });
}

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
  // An upload whose row was never written: `startImport` puts the file
  // first, and since D-110 no bucket rule expires it.
  const unnamedUploadKey = `imports/${userId}/${newUlid()}.tcx`;
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
      audience: "runners",
      createdAt: NOW,
    }),
    conditionsCopy(runIds, userId),
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
    // An ask waiting on its link under every address they are known by.
    core.insert(accessAsks).values(
      [email, redeemedAs, movingTo(email)].map((address) => ({
        id: newUlid(),
        email: address.toLowerCase(),
        tokenHash: newUlid(),
        createdAt: NOW,
      })),
    ),
    // An access request under every address they are known by.
    core.insert(accessRequests).values(
      [email, redeemedAs, movingTo(email)].map((address) => ({
        id: newUlid(),
        email: address.toLowerCase(),
        createdAt: NOW,
        updatedAt: NOW,
      })),
    ),
    // Invite codes whose label names them (each code carries the whole id:
    // four characters of it collided across runners in one isolate): one
    // written before D7 stopped
    // copying a request's address onto its code, and one an operator
    // typed, in the address's own mixed case.
    core.insert(inviteCodes).values([
      {
        id: newUlid(),
        code: `DIAL-${tail}-A`,
        label: `${redeemedAs} (request)`,
        createdAt: NOW,
      },
      {
        id: newUlid(),
        code: `DIAL-${tail}-B`,
        label: `Club night, ${email}`,
        createdAt: NOW,
      },
    ]),
    core
      .insert(rateLimits)
      .values([
        countRow("enrich-runner", userId, 1, NOW),
        countRow("change-runner", userId, 1, NOW),
        countRow("upload-runner", userId, 1, NOW),
        countRow("weather-runner", userId, 1, NOW),
        countRow("photo-runner", userId, 1, NOW),
        countRow("purge-runner", userId, 1, NOW),
        countRow("manual-run-runner", userId, 1, NOW),
        countRow("deletion-notice", userId, 1, NOW),
      ]),
    // The counts kept by address, in their own statement: with the
    // runner's above, one insert binds more parameters than D1 takes.
    core
      .insert(rateLimits)
      .values(
        addressesOf(email).flatMap((address) =>
          ADDRESS_SENDS.map((kind) => countRow(kind, address, 1, NOW)),
        ),
      ),
    // Its own statement: one more row in the insert above binds more
    // parameters than D1 takes.
    core
      .insert(rateLimits)
      .values([
        countRow("correction-runner", userId, 1, NOW),
        countRow("strava-connect-runner", userId, 1, NOW),
        countRow("shared-row-runner", userId, 1, NOW),
        countRow("handle-runner", userId, 1, NOW),
      ]),
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
  const uploadKeys = [looseUploadKey, runUploadKey, unnamedUploadKey];
  for (const key of uploadKeys) {
    await env.IMPORTS.put(key, "bytes");
  }
  // The terms they accepted (ACC-6), two versions of them.
  await core.insert(termsAcceptances).values([
    { userId, version: 1, acceptedAt: NOW - 120 },
    { userId, version: 2, acceptedAt: NOW - 60 },
  ]);
  // A day the Strava reminder email covered (STR-9).
  await core
    .insert(reminderEmailDays)
    .values({ userId, day: "2026-10-01", coveredUntil: NOW });
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
    uploadKeys,
  };
}

function byKey(a: { dedupeKey: string }, b: { dedupeKey: string }): number {
  return a.dedupeKey.localeCompare(b.dedupeKey);
}

function byText(a: string, b: string): number {
  return a.localeCompare(b);
}

/**
Every count whose subject is one of the runner's addresses.
*/
function addressCounts(email: string) {
  return inArray(rateLimits.subject, provedOf(email));
}

/**
A runner's own count of one kind, which the purge forgets.
*/
function runnersCount(
  kind:
    | "change-runner"
    | "enrich-runner"
    | "upload-runner"
    | "weather-runner"
    | "photo-runner"
    | "purge-runner"
    | "manual-run-runner"
    | "deletion-notice"
    | "correction-runner"
    | "strava-connect-runner"
    | "shared-row-runner"
    | "handle-runner",
  userId: string,
) {
  return and(eq(rateLimits.kind, kind), eq(rateLimits.subject, userId));
}

/**
The counts kept by the address, which the purge forgets with it.
*/
const ADDRESS_SENDS = [
  "verify",
  "reset",
  "change",
  "sign-in",
  "takedown-to",
  "access-to",
  "access-confirm-to",
] as const;

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
  return [...provedOf(email), movingTo(email).toLowerCase()];
}

/**
 * The addresses a seeded runner proved theirs, lower-cased: the account's
 * (confirmed) and the one they redeemed their invite with. The address of
 * their open email change is only named.
 */
function provedOf(email: string): string[] {
  return [email.toLowerCase(), firstAddress(email)];
}

/**
 * What is left under the address a seeded runner only named (their open
 * email change): its access request and its counts.
 */
async function namedLeft(seeded: Seeded) {
  const address = movingTo(seeded.email).toLowerCase();
  const [requests, counts] = await core.batch([
    core
      .select({ email: accessRequests.email })
      .from(accessRequests)
      .where(eq(accessRequests.email, address)),
    core
      .select({ kind: rateLimits.kind })
      .from(rateLimits)
      .where(eq(rateLimits.subject, address))
      .orderBy(rateLimits.kind),
  ]);
  return { requests, counts: counts.map((row) => row.kind) };
}

/**
Everything `namedLeft` reads, as the seed wrote it.
*/
function namedAsSeeded(seeded: Seeded) {
  return {
    requests: [{ email: movingTo(seeded.email).toLowerCase() }],
    counts: ADDRESS_SENDS.toSorted((a, b) => a.localeCompare(b)),
  };
}

/**
 * What R2 still holds under the runner's prefixes — the garment photos',
 * the entry photos' and the uploads' — once the outbox's R2 debts have
 * been drained, as the daily firing drains them.
 */
async function r2Left(userId: string): Promise<string[]> {
  await drainOutbox(core, [], {
    handlers: outboxHandlers,
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
    runConditions: await core
      .select()
      .from(runConditions)
      .where(eq(runConditions.userId, userId)),
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
    rings: await core
      .select()
      .from(followNotices)
      .where(
        or(
          eq(followNotices.followerId, userId),
          eq(followNotices.followeeId, userId),
        ),
      ),
    corrections: await core
      .select()
      .from(productCorrections)
      .where(eq(productCorrections.userId, userId)),
    heldTakeDowns: await core
      .select()
      .from(heldTakeDowns)
      .where(eq(heldTakeDowns.ownerId, userId)),
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
      .where(inArray(accessRequests.email, provedOf(seeded.email))),
    accessAsks: await core
      .select({ email: accessAsks.email })
      .from(accessAsks)
      .where(inArray(accessAsks.email, provedOf(seeded.email))),
    inviteLabels: await core
      .select({ label: inviteCodes.label })
      .from(inviteCodes)
      .where(
        or(
          ...provedOf(seeded.email).map(
            (address) =>
              sql`instr(lower(${inviteCodes.label}), ${address}) > 0`,
          ),
        ),
      ),
    sendLimits: await core
      .select()
      .from(rateLimits)
      .where(
        or(
          addressCounts(seeded.email),
          runnersCount("change-runner", userId),
          runnersCount("weather-runner", userId),
          runnersCount("photo-runner", userId),
          runnersCount("purge-runner", userId),
          runnersCount("manual-run-runner", userId),
          runnersCount("deletion-notice", userId),
          runnersCount("correction-runner", userId),
          runnersCount("strava-connect-runner", userId),
          runnersCount("shared-row-runner", userId),
        ),
      ),
    spendLimits: await core
      .select()
      .from(rateLimits)
      .where(runnersCount("enrich-runner", userId)),
    uploadLimits: await core
      .select()
      .from(rateLimits)
      .where(runnersCount("upload-runner", userId)),
    handleLimits: await core
      .select()
      .from(rateLimits)
      .where(runnersCount("handle-runner", userId)),
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
    reminderDays: await core
      .select()
      .from(reminderEmailDays)
      .where(eq(reminderEmailDays.userId, userId)),
    claim: await claimOf(userId),
  };
}

const GONE = {
  user: [],
  session: [],
  account: [],
  profile: [],
  runConditions: [],
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
  rings: [],
  corrections: [],
  heldTakeDowns: [],
  notifications: [],
  preferences: [],
  verifications: [],
  passwordAttempts: [],
  accessRequests: [],
  accessAsks: [],
  inviteLabels: [],
  sendLimits: [],
  spendLimits: [],
  uploadLimits: [],
  handleLimits: [],
  resetLinks: [],
  garments: [],
  imports: [],
  strava: [],
  exports: [],
  terms: [],
  reminderDays: [],
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
  it("claims three accounts a round for five minutes, and holds a claim for an hour", () => {
    expect(PURGE_PER_ROUND).toBe(3);
    expect(PURGE_BUDGET_MS).toBe(300_000);
    expect(PURGE_LEASE_S).toBe(3600);
  });
});

/**
 * A clock whose every reading is `PURGE_BUDGET_MS` later than the last,
 * from 0: a firing on it claims one round and no more.
 */
function oneRoundClock(): () => number {
  let reading = CLOCK_START - PURGE_BUDGET_MS;
  return () => (reading += PURGE_BUDGET_MS);
}

/**
A clock that reads `elapsed` after its first reading, every time.
*/
// Clocks read the epoch in milliseconds, as `Date.now` does.
const CLOCK_START = NOW * 1000;

function clockAt(elapsed: number): () => number {
  let reading: number | undefined;
  return () => {
    const at = CLOCK_START + (reading ?? 0);
    reading = elapsed;
    return at;
  };
}

/**
 * Most clock readings one firing here may take. A loop that never ends
 * reads the clock every round, so its test throws here rather than
 * running until the test times out.
 */
const MOST_READINGS = 50;

function bounded(clock: () => number): () => number {
  let readings = 0;
  return () => {
    readings += 1;
    if (readings > MOST_READINGS) throw new Error("The firing never ended");
    return clock();
  };
}

/**
`purgeDueAccounts` on a clock that stops a firing that never ends; a clock still at its start by default.
*/
function purge(
  anomalies: string[],
  deps: PurgeDeps,
  clock: () => number = clockAt(0),
): Promise<void> {
  return purgeDueAccounts(anomalies, deps, bounded(clock));
}

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
      core.insert(followNotices).values({
        followeeId: third,
        followerId: other.userId,
        notificationId: newUlid(),
        rungAt: NOW,
      }),
      core.insert(productCorrections).values({
        id: newUlid(),
        productId: newUlid(),
        userId: other.userId,
        garmentId: newUlid(),
        field: "weight",
        value: "light",
        idempotencyKey: newUlid(),
        createdAt: NOW,
      }),
      core.insert(heldTakeDowns).values({
        actionId: newUlid(),
        subjectType: "entry",
        subjectId: other.entryId,
        entryId: other.entryId,
        ownerId: other.userId,
        createdAt: NOW,
      }),
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
      core.insert(followNotices).values([
        {
          followeeId: other.userId,
          followerId: runner.userId,
          notificationId: newUlid(),
          rungAt: NOW,
        },
        {
          followeeId: runner.userId,
          followerId: other.userId,
          notificationId: newUlid(),
          rungAt: NOW,
        },
      ]),
      core.insert(productCorrections).values({
        id: newUlid(),
        productId: newUlid(),
        userId: runner.userId,
        garmentId: newUlid(),
        field: "fabric",
        value: "merino",
        idempotencyKey: newUlid(),
        createdAt: NOW,
      }),
      core.insert(heldTakeDowns).values({
        actionId: newUlid(),
        subjectType: "entry",
        subjectId: runner.entryId,
        entryId: runner.entryId,
        ownerId: runner.userId,
        createdAt: NOW,
      }),
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
      core
        .insert(rateLimits)
        .values(countRow("access", `1.2.3.4-${runner.userId}`, 1, NOW)),
    ]);
    await claim(runner.userId, NOW - 1);
    const { deps, revoked, reported } = depsAt(NOW);
    const anomalies: string[] = [];

    await purge(anomalies, deps);

    expect(await footprint(runner)).toStrictEqual(GONE);
    expect(await namedLeft(runner)).toStrictEqual(namedAsSeeded(runner));
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
    expect(await countedKeys(core)).toContain(
      `access:1.2.3.4-${runner.userId}`,
    );

    // What R2 is owed: each garment's photos. The entries' prefix and the
    // run's upload were settled by feed's fast path, and every other run
    // file (D-110) by the purge's own listing — the upload that never
    // became a run and the one no row ever named alike — before any drain.
    const owed = await core
      .select({ kind: outbox.kind, dedupeKey: outbox.dedupeKey })
      .from(outbox)
      .where(like(outbox.dedupeKey, `${runner.userId}:%`));
    expect(owed.toSorted(byKey)).toStrictEqual(
      runner.garmentIds
        .map((itemId) => ({
          kind: "photo_delete",
          dedupeKey: `${runner.userId}:${itemId}`,
        }))
        .toSorted(byKey),
    );
    for (const key of runner.uploadKeys) {
      expect(await env.IMPORTS.head(key)).toBeNull();
    }
    const otherOwes = await core
      .select({ id: outbox.id })
      .from(outbox)
      .where(like(outbox.dedupeKey, `${other.userId}:%`));
    expect(otherOwes).toStrictEqual([]);

    // And once those are paid, R2 holds nothing of theirs — and all of
    // the other runner's.
    const otherObjects = await r2Keys(other.userId);
    expect(otherObjects).toHaveLength(8);
    expect(await r2Left(runner.userId)).toStrictEqual([]);
    expect(await r2Keys(other.userId)).toStrictEqual(otherObjects);
    // The codes that named them are kept, labelled by nothing.
    const codes = await core
      .select({ label: inviteCodes.label })
      .from(inviteCodes)
      .where(
        inArray(inviteCodes.code, [
          `DIAL-${runner.userId.toLowerCase()}-A`,
          `DIAL-${runner.userId.toLowerCase()}-B`,
        ]),
      );
    expect(codes).toHaveLength(2);
    for (const code of codes) expect(code.label).toBeNull();
  });

  it("forgets the runner's handle-claim count (owner, 2026-11-26, #1076)", async () => {
    const runner = await seedAccount();
    const other = await seedAccount();
    await claim(runner.userId, NOW - 1);
    const before = await footprint(runner);
    expect(before.handleLimits).toHaveLength(1);

    await purge([], depsAt(NOW).deps);

    const after = await footprint(runner);
    const others = await footprint(other);
    expect(after.handleLimits).toStrictEqual([]);
    expect(others.handleLimits).toHaveLength(1);
  });

  it("writes no retired handle for a runner who never chose one", async () => {
    const runner = await seedAccount();
    await core
      .update(userProfiles)
      .set({ username: orSqlNull(undefined) })
      .where(eq(userProfiles.userId, runner.userId));
    await claim(runner.userId, NOW - 1);

    await purge([], depsAt(NOW).deps);

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

    await purge(anomalies, deps);

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

    await purge(anomalies, deps);

    expect(await footprint(runner)).toStrictEqual(before);
    expect(revoked).toStrictEqual([]);
    expect(anomalies).toStrictEqual([]);
  });

  it("takes a claim due this very second", async () => {
    const userId = await claimedProfile(NOW);

    await purge([], depsAt(NOW).deps);

    expect(await hasProfile(userId)).toBe(false);
    expect(await claimOf(userId)).toStrictEqual([]);
  });

  it("skips a claim another firing still holds, and does not count it as waiting", async () => {
    const tenMinutesAgo = await claimedProfile(NOW - 86_400, NOW - 600);
    const leaseEdge = await claimedProfile(NOW - 86_400, NOW - PURGE_LEASE_S);
    const { deps, revoked } = depsAt(NOW);
    const anomalies: string[] = [];

    await purge(anomalies, deps);

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

    await purge([], deps);

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

    await purge(anomalies, deps, oneRoundClock());

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
    await purge(nextAnomalies, next.deps);

    expect(next.revoked.toSorted(byText)).toStrictEqual(
      newest.toSorted(byText),
    );
    expect(nextAnomalies).toStrictEqual([]);
  });
});

describe("purgeDueAccounts — rounds", () => {
  it("claims round after round while it has time, until nothing is due", async () => {
    const userIds: string[] = [];
    for (let age = 1; age <= PURGE_PER_ROUND * 2 + 1; age++) {
      userIds.push(await claimedProfile(NOW - age * 60));
    }
    const { deps, revoked } = depsAt(NOW);
    const anomalies: string[] = [];

    await purge(anomalies, deps, clockAt(PURGE_BUDGET_MS - 1));

    expect(revoked.toSorted(byText)).toStrictEqual(userIds.toSorted(byText));
    expect(anomalies).toStrictEqual([]);
  });

  it("starts no round once the budget is spent", async () => {
    for (let age = 1; age <= PURGE_PER_ROUND + 1; age++) {
      await claimedProfile(NOW - age * 60);
    }
    const { deps, revoked } = depsAt(NOW);
    const anomalies: string[] = [];

    await purge(anomalies, deps, clockAt(PURGE_BUDGET_MS));

    expect(revoked).toHaveLength(PURGE_PER_ROUND);
    expect(anomalies).toStrictEqual([
      "1 account deletion(s) past their date wait for the next firing",
    ]);
  });

  it("does not take a failed claim again in a later round", async () => {
    const failing = await claimedProfile(NOW - 60);
    const { deps, revoked } = depsAt(NOW, [failing]);
    const anomalies: string[] = [];

    await purge(anomalies, deps, clockAt(0));

    expect(revoked).toStrictEqual([failing]);
    expect(anomalies).toStrictEqual([
      "1 account deletion(s) stopped part way and are finished on the next firing",
    ]);
  });

  it("takes a claim a purge failed on only after every one never tried", async () => {
    // The oldest by date, retaken after its lease ran out.
    const retried = await claimedProfile(
      NOW - 30 * 86_400,
      NOW - PURGE_LEASE_S - 1,
    );
    const untried: string[] = [];
    for (let age = 1; age <= PURGE_PER_ROUND; age++) {
      untried.push(await claimedProfile(NOW - age * 60));
    }
    const { deps, revoked } = depsAt(NOW);

    await purge([], deps, oneRoundClock());

    expect(revoked.toSorted(byText)).toStrictEqual(untried.toSorted(byText));
    expect(await hasProfile(retried)).toBe(true);
  });
});

async function holdOn(
  ownerId: string,
  status: (typeof copyrightHolds.$inferInsert)["status"],
): Promise<void> {
  await core.insert(copyrightHolds).values({
    id: newUlid(),
    moderationActionId: newUlid(),
    subjectType: "entry",
    subjectId: newUlid(),
    ownerId,
    entryId: newUlid(),
    status,
    hiddenAt: NOW - 86_400,
    purgeAt: NOW + 29 * 86_400,
  });
}

async function bellRow(
  userId: string,
  groupId: string,
  linkId: string | undefined,
  body: string,
): Promise<string> {
  const id = newUlid();
  await core.insert(notifications).values({
    id,
    userId,
    kind: "followed",
    subjectId: groupId,
    linkId,
    body,
    read: false,
    createdAt: NOW,
  });
  return id;
}

async function ring(
  followerId: string,
  followeeId: string,
  groupId: string,
): Promise<void> {
  await core.insert(followNotices).values({
    followerId,
    followeeId,
    notificationId: groupId,
    rungAt: NOW,
  });
}

describe("purgeDueAccounts — a live copyright hold", () => {
  it.each(["hidden", "purging"] as const)(
    "leaves an account whose hold is %s, and the digest says it waits on the hold",
    async (status) => {
      const held = await claimedProfile(NOW - 60);
      const other = await claimedProfile(NOW - 60);
      await holdOn(held, status);
      await holdOn(other, "restored");
      await holdOn(other, "purged");
      const { deps, revoked } = depsAt(NOW);
      const anomalies: string[] = [];

      await purge(anomalies, deps);

      expect(revoked).toStrictEqual([other]);
      expect(await hasProfile(held)).toBe(true);
      const [claimRow] = await claimOf(held);
      expect(claimRow?.purgeStartedAt).toBeNull();
      expect(anomalies).toStrictEqual([
        "1 account deletion(s) wait for a copyright hold to settle",
      ]);
    },
  );

  it("says nothing of a held account that is not yet due", async () => {
    const held = await claimedProfile(NOW + 60);
    await holdOn(held, "hidden");
    const anomalies: string[] = [];

    await purge(anomalies, depsAt(NOW).deps);

    expect(anomalies).toStrictEqual([]);
  });
});

describe("purgeAccount — the follow rows on others' bells", () => {
  it("deletes a row they rang or a group naming them, and keeps a group naming someone else", async () => {
    const runner = await seedAccount();
    const [alone, named, unnamed, unrung, prefixed] = [
      newUlid(),
      newUlid(),
      newUlid(),
      newUlid(),
      newUlid(),
    ];
    const [soloGroup, namedGroup, otherGroup, prefixedGroup] = [
      newUlid(),
      newUlid(),
      newUlid(),
      newUlid(),
    ];
    await ring(runner.userId, alone, soloGroup);
    await ring(runner.userId, named, namedGroup);
    await ring(runner.userId, unnamed, otherGroup);
    await ring(runner.userId, prefixed, prefixedGroup);
    await bellRow(
      alone,
      soloGroup,
      runner.userId,
      `@${runner.handle} followed you.`,
    );
    await bellRow(
      named,
      namedGroup,
      undefined,
      `@${runner.handle} and 2 others followed you.`,
    );
    const kept = await bellRow(
      unnamed,
      otherGroup,
      undefined,
      "@someone_else and 1 other followed you.",
    );
    // A handle that starts with theirs is not theirs.
    const longer = await bellRow(
      prefixed,
      prefixedGroup,
      undefined,
      `@${runner.handle}x and 1 other followed you.`,
    );
    // A row they never rang, though its words name them.
    const notRung = await bellRow(
      unrung,
      newUlid(),
      undefined,
      `@${runner.handle} followed you.`,
    );

    await purgeAccount(depsAt(NOW).deps, runner.userId);

    const left = await core
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        inArray(notifications.userId, [
          alone,
          named,
          unnamed,
          unrung,
          prefixed,
        ]),
      );
    expect(left.map((row) => row.id).toSorted(byText)).toStrictEqual(
      [kept, longer, notRung].toSorted(byText),
    );
  });

  it("deletes only the row linking to them when they had no handle", async () => {
    const userId = newUlid();
    const [followee, other] = [newUlid(), newUlid()];
    const [group, otherGroup] = [newUlid(), newUlid()];
    await ring(userId, followee, group);
    await ring(userId, other, otherGroup);
    await bellRow(followee, group, userId, "@gone followed you.");
    // A runner may be called "undefined"; a group naming them stays.
    const kept = await bellRow(
      other,
      otherGroup,
      undefined,
      "@undefined and 1 other followed you.",
    );

    await purgeAccount(depsAt(NOW).deps, userId);

    const left = await core
      .select({ id: notifications.id })
      .from(notifications)
      .where(inArray(notifications.userId, [followee, other]));
    expect(left).toStrictEqual([{ id: kept }]);
  });

  it("leaves another kind of row in the same group", async () => {
    const runner = await seedAccount();
    const followee = newUlid();
    const group = newUlid();
    await ring(runner.userId, followee, group);
    const id = newUlid();
    await core.insert(notifications).values({
      id,
      userId: followee,
      kind: "content_kept",
      subjectId: group,
      linkId: runner.userId,
      body: `@${runner.handle} followed you.`,
      read: false,
      createdAt: NOW,
    });

    await purgeAccount(depsAt(NOW).deps, runner.userId);

    const left = await core
      .select({ id: notifications.id })
      .from(notifications)
      .where(eq(notifications.userId, followee));
    expect(left).toStrictEqual([{ id }]);
  });

  it("leaves a row in their ring's group on a bell they never rang", async () => {
    const runner = await seedAccount();
    const [followee, bystander] = [newUlid(), newUlid()];
    const group = newUlid();
    await ring(runner.userId, followee, group);
    const id = await bellRow(bystander, group, runner.userId, "x");

    await purgeAccount(depsAt(NOW).deps, runner.userId);

    const left = await core
      .select({ id: notifications.id })
      .from(notifications)
      .where(eq(notifications.userId, bystander));
    expect(left).toStrictEqual([{ id }]);
  });
});

describe("purgeDueAccounts — a purge that stops part way", () => {
  it("reports it, keeps the claim, and the next firing finishes it", async () => {
    const runner = await seedAccount();
    const bystander = await claimedProfile(NOW - 1);
    await claim(runner.userId, NOW - 1);
    const first = depsAt(NOW, [runner.userId]);
    const anomalies: string[] = [];

    await purge(anomalies, first.deps);

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
    await purge([], overlapping.deps);
    expect(overlapping.revoked).toStrictEqual([]);

    const next = depsAt(NOW + PURGE_LEASE_S + 1);
    const nextAnomalies: string[] = [];
    await purge(nextAnomalies, next.deps);

    expect(next.revoked).toStrictEqual([runner.userId]);
    expect(next.reported).toStrictEqual([]);
    expect(nextAnomalies).toStrictEqual([]);
    expect(await footprint(runner)).toStrictEqual(GONE);
  });
});

describe("purgeDueAccounts — a purge that stops deleting the runner's files", () => {
  it("keeps the claim and the files it could not reach, and the next firing deletes them", async () => {
    const runner = await seedAccount();
    await claim(runner.userId, NOW - 1);
    // The purge's listing deletes a page at a time, as a list of keys.
    const remove = env.IMPORTS.delete.bind(env.IMPORTS);
    let hasFailed = false;
    vi.spyOn(env.IMPORTS, "delete").mockImplementation((keys) => {
      if (!hasFailed && Array.isArray(keys)) {
        hasFailed = true;
        return Promise.reject(new Error("R2 is down"));
      }
      return remove(keys);
    });
    const first = depsAt(NOW);
    const anomalies: string[] = [];

    await purge(anomalies, first.deps);
    vi.restoreAllMocks();

    expect(first.reported).toStrictEqual([
      {
        error: new Error("R2 is down"),
        context: { surface: "account-purge", userId: runner.userId },
      },
    ]);
    expect(anomalies).toStrictEqual([
      "1 account deletion(s) stopped part way and are finished on the next firing",
    ]);
    const stopped = await footprint(runner);
    expect(stopped.imports).toStrictEqual([]);
    expect(stopped.claim).toHaveLength(1);
    const [looseUpload = "", runUpload = "", unnamedUpload = ""] =
      runner.uploadKeys;
    // Every file waits for the listing, the run's too: deleting all of a
    // runner's runs owes no file of its own.
    expect(await env.IMPORTS.head(runUpload)).not.toBeNull();
    expect(await env.IMPORTS.head(looseUpload)).not.toBeNull();
    expect(await env.IMPORTS.head(unnamedUpload)).not.toBeNull();

    await purge([], depsAt(NOW + PURGE_LEASE_S + 1).deps);

    expect(await footprint(runner)).toStrictEqual(GONE);
    const left = await env.IMPORTS.list({
      prefix: `imports/${runner.userId}/`,
    });
    expect(left.objects).toStrictEqual([]);
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
 * Each of `purgeAccount`'s seven steps, stopped in turn: how to stop it,
 * and what the rows say about where it stopped — the step before it done,
 * its own not — so each case proves it interrupted the step it names.
 */
const STEPS: readonly {
  readonly step: string;
  readonly stop: (runner: Seeded) => Recorded;
  readonly stoppedAt: (partial: Footprint, revoked: readonly string[]) => void;
}[] = [
  {
    step: "1 · the Strava grant",
    stop: (runner) => depsAt(NOW, [runner.userId]),
    stoppedAt: (partial, revoked) => {
      expect(revoked).toHaveLength(1);
      expect(partial.manualConditions).toHaveLength(1);
      expect(partial.screenings).toHaveLength(2);
    },
  },
  {
    step: "2 · the photo screenings",
    stop: () => {
      // The claim's batch is the first.
      failBatch(2);
      return depsAt(NOW);
    },
    stoppedAt: (partial, revoked) => {
      expect(revoked).toHaveLength(1);
      expect(partial.screenings).toHaveLength(2);
      expect(partial.manualConditions).toHaveLength(1);
      expect(partial.runs).toHaveLength(2);
    },
  },
  {
    step: "3 · a page's bands in DIALED_WEATHER",
    stop: () => depsAt(NOW, [], true),
    stoppedAt: (partial, revoked) => {
      expect(revoked).toHaveLength(1);
      expect(partial.screenings).toStrictEqual([]);
      expect(partial.manualConditions).toHaveLength(1);
      expect(partial.runs).toHaveLength(2);
    },
  },
  {
    step: "4 · a page's runs and entries",
    stop: () => {
      failBatch(3);
      return depsAt(NOW);
    },
    stoppedAt: (partial) => {
      expect(partial.manualConditions).toStrictEqual([]);
      expect(partial.runs).toHaveLength(2);
      expect(partial.garments).toHaveLength(2);
    },
  },
  {
    step: "5 · the entries left",
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
    step: "6 · the closet",
    stop: () => {
      failBatch(5);
      return depsAt(NOW);
    },
    stoppedAt: (partial) => {
      expect(partial.runs).toStrictEqual([]);
      expect(partial.garments).toHaveLength(2);
      expect(partial.user).toHaveLength(1);
    },
  },
  {
    step: "7 · the account itself",
    stop: () => {
      // Its last batch, after the closet's.
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

      await purge(anomalies, first.deps);
      vi.restoreAllMocks();

      expect(first.reported).toHaveLength(1);
      expect(anomalies).toStrictEqual([
        "1 account deletion(s) stopped part way and are finished on the next firing",
      ]);
      stoppedAt(await footprint(runner), first.revoked);

      const next = depsAt(NOW + PURGE_LEASE_S + 1);
      const nextAnomalies: string[] = [];
      await purge(nextAnomalies, next.deps);

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
    await purge([], depsAt(NOW, [], true).deps);

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

    await purge([], deps);

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

  it("forgets the athlete's dead-lettered reminders and no one else's (R-142)", async () => {
    const runner = await seedAccount();
    const [connection] = await core
      .select({ athleteId: stravaConnections.athleteId })
      .from(stravaConnections)
      .where(eq(stravaConnections.userId, runner.userId));
    const left = await seedAthleteGaveUp(connection?.athleteId ?? "");
    await claim(runner.userId, nowSeconds() - 1);

    await purgeDueAccounts([]);

    expect(await left()).toStrictEqual(ONLY_THEIRS_GONE);
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

const CLOSED_KEY = "closed-address-test-key";

async function dueRunner(isClosed: boolean): Promise<Seeded> {
  const runner = await seedAccount();
  if (isClosed) {
    await core
      .update(userProfiles)
      .set({ bannedAt: NOW - 3600 })
      .where(eq(userProfiles.userId, runner.userId));
  }
  await claim(runner.userId, NOW - 1);
  return runner;
}

async function closedKept() {
  return core
    .select({
      hash: closedAddresses.hash,
      closedAt: closedAddresses.closedAt,
    })
    .from(closedAddresses)
    .orderBy(closedAddresses.hash);
}

/**
 * SA-L09: an account an operator closed leaves its addresses behind as
 * keyed fingerprints, so sign-up can refuse them; anyone else's leave
 * nothing. A test key, not a deployed one.
 */
describe("purgeDueAccounts — a closed account's addresses", () => {
  beforeEach(async () => {
    await core.delete(closedAddresses);
  });

  it("keeps each address of a closed account as a fingerprint", async () => {
    const runner = await dueRunner(true);
    const anomalies: string[] = [];

    await purge(anomalies, {
      ...depsAt(NOW).deps,
      closedAddressSecret: CLOSED_KEY,
    });

    expect(await footprint(runner)).toStrictEqual(GONE);
    const hashes = await Promise.all(
      provedOf(runner.email).map((address) =>
        closedAddressHash(CLOSED_KEY, address),
      ),
    );
    expect(await closedKept()).toStrictEqual(
      hashes.toSorted(byText).map((hash) => ({ hash, closedAt: NOW })),
    );
    expect(anomalies).toStrictEqual([]);
  });

  it("keeps and forgets nothing by address for a closed account that never confirmed its address", async () => {
    const runner = await dueRunner(true);
    await core
      .update(user)
      .set({ emailVerified: false })
      .where(eq(user.id, runner.userId));
    const anomalies: string[] = [];

    await purge(anomalies, {
      ...depsAt(NOW).deps,
      closedAddressSecret: CLOSED_KEY,
    });

    expect(await closedKept()).toStrictEqual([]);
    expect(anomalies).toStrictEqual([]);
    const own = await core
      .select({ email: accessRequests.email })
      .from(accessRequests)
      .where(inArray(accessRequests.email, addressesOf(runner.email)))
      .orderBy(accessRequests.email);
    expect(own.map((row) => row.email)).toStrictEqual(
      addressesOf(runner.email).toSorted(byText),
    );
    expect(
      await core.select().from(user).where(eq(user.id, runner.userId)),
    ).toStrictEqual([]);
  });

  it("blanks the label of the code an unconfirmed account spent where it names the address it spent it with, and no other label", async () => {
    const runner = await dueRunner(true);
    const spentId = newUlid();
    const otherId = newUlid();
    await core.batch([
      core
        .update(user)
        .set({ emailVerified: false })
        .where(eq(user.id, runner.userId)),
      core
        .update(inviteRedemptions)
        .set({ codeId: spentId })
        .where(eq(inviteRedemptions.userId, runner.userId)),
      core.insert(inviteCodes).values([
        {
          id: spentId,
          code: `DIAL-${spentId}`,
          label: `Sent to ${runner.redeemedAs.toUpperCase()}`,
          createdAt: NOW,
        },
        {
          id: otherId,
          code: `DIAL-${otherId}`,
          label: `Sent to ${runner.redeemedAs}`,
          createdAt: NOW,
        },
      ]),
    ]);

    await purge([], {
      ...depsAt(NOW).deps,
      closedAddressSecret: CLOSED_KEY,
    });

    const labels = await core
      .select({ id: inviteCodes.id, label: inviteCodes.label })
      .from(inviteCodes)
      .where(inArray(inviteCodes.id, [spentId, otherId]));
    expect(
      new Map(labels.map((row) => [row.id, row.label ?? undefined])),
    ).toStrictEqual(
      new Map([
        [spentId, undefined],
        [otherId, `Sent to ${runner.redeemedAs}`],
      ]),
    );
  });

  it("keeps the label of the code a runner spent when it names no address of theirs", async () => {
    const runner = await dueRunner(false);
    const spentId = newUlid();
    await core.batch([
      core
        .update(inviteRedemptions)
        .set({ codeId: spentId })
        .where(eq(inviteRedemptions.userId, runner.userId)),
      core.insert(inviteCodes).values({
        id: spentId,
        code: `DIAL-${spentId}`,
        label: "Club night",
        createdAt: NOW,
      }),
    ]);

    await purge([], depsAt(NOW).deps);

    expect(
      await core
        .select({ label: inviteCodes.label })
        .from(inviteCodes)
        .where(eq(inviteCodes.id, spentId)),
    ).toStrictEqual([{ label: "Club night" }]);
  });

  it("fingerprints only the account's own address when it has no invite on record", async () => {
    const runner = await dueRunner(true);
    await core
      .delete(inviteRedemptions)
      .where(eq(inviteRedemptions.userId, runner.userId));

    await purge([], {
      ...depsAt(NOW).deps,
      closedAddressSecret: CLOSED_KEY,
    });

    expect(await closedKept()).toStrictEqual([
      {
        hash: await closedAddressHash(CLOSED_KEY, runner.email.toLowerCase()),
        closedAt: NOW,
      },
    ]);
  });

  it("keeps nothing of an account that was not closed", async () => {
    const runner = await dueRunner(false);
    const anomalies: string[] = [];

    await purge(anomalies, {
      ...depsAt(NOW).deps,
      closedAddressSecret: CLOSED_KEY,
    });

    expect(await footprint(runner)).toStrictEqual(GONE);
    expect(await closedKept()).toStrictEqual([]);
    expect(anomalies).toStrictEqual([]);
  });

  it("purges a closed account without a key, and the digest says nothing was kept", async () => {
    const runner = await dueRunner(true);
    await dueRunner(false);
    const anomalies: string[] = [];

    await purge(anomalies, depsAt(NOW).deps);

    expect(await footprint(runner)).toStrictEqual(GONE);
    expect(await closedKept()).toStrictEqual([]);
    expect(anomalies).toStrictEqual([
      "1 closed account(s) were purged with their addresses unremembered: CLOSED_ADDRESS_SECRET is not set",
    ]);
  });

  it("lets go of fingerprints past 3 years on each firing, with nothing due", async () => {
    const [atEdge, past] = await Promise.all([
      closedAddressHash(CLOSED_KEY, "edge@example.test"),
      closedAddressHash(CLOSED_KEY, "past@example.test"),
    ]);
    await core.insert(closedAddresses).values([
      { hash: atEdge, closedAt: NOW - CLOSED_ADDRESS_KEPT_S },
      { hash: past, closedAt: NOW - CLOSED_ADDRESS_KEPT_S - 1 },
    ]);

    await purge([], depsAt(NOW).deps);

    expect(await closedKept()).toStrictEqual([
      { hash: atEdge, closedAt: NOW - CLOSED_ADDRESS_KEPT_S },
    ]);
  });
});
