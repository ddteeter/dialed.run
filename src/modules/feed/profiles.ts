/**
 * Profiles (G own / H someone else's). Public at MVP — a documented
 * privacy decision (design doc "Open questions"), not an oversight: the
 * other-profile query strips everything but display info + recent public
 * entries (no aggregates, no offset translation).
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import {
  outfitEntries,
  outfitEntryItems,
  runs,
  userProfiles,
} from "../../db/schema-core";
import { env } from "../../env";
import { garmentNamesByIds } from "./garment-names";
import { readInChunks } from "../../lib/chunked";
import { bandLabel } from "../../lib/contracts/temperature";
import { topByCount } from "../../lib/top-by-count";
import { observationsForEntries } from "./conditions";
import { recentOwnEntries } from "./own-history";
import { bandsAscending, tallyCoverage } from "./coverage";
import type { CoverageBand } from "./coverage";
import { unitsFor } from "./units";
import { countWhere } from "./count-where";
import { followerCount, followingCount, isFollowing } from "./follows";
import { lookUpHandle } from "../account";
import { publiclyVisibleEntry } from "../safety";
import { runnersVisibleTo } from "./runner-visibility";
import { outfitEntriesSelect } from "./entries-query";

function db() {
  return drizzle(env.DIALED_CORE);
}

const RECENT_LIMIT = 20;

export interface OwnProfile {
  userId: string;
  username: string | undefined;
  cityLabel: string | undefined;
  thermalLevel: number | undefined;
  followerCount: number;
  followingCount: number;
  entryCount: number;
  /**
  Every run logged, entry or not — G's first count (round 22, "G New
  account"), and what decides whether G is on day one.
  */
  runCount: number;
  coverage: CoverageBand[];
  mostWornItems: { itemId: string; name: string; wearCount: number }[];
  recentEntries: {
    entryId: string;
    createdAt: number;
    verdict: number | null;
  }[];
}

/**
 * Bands ascending by floor. The caller tracks the min/max floor it saw
 * while building `bands` so this never needs to iterate the map's keys to
 * sort them (no in-memory `.sort()`, per house lint rule).
 */

export async function ownProfile(userId: string): Promise<OwnProfile> {
  const database = db();
  const [profile] = await database
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);

  const profileEntries = await recentOwnEntries(database, userId);
  const observations = await observationsForEntries(database, profileEntries);
  const units = await unitsFor(database, userId);

  const tally = tallyCoverage(profileEntries, observations, (floor) =>
    bandLabel(floor, units.temp),
  );

  const entryIds = profileEntries.map((e) => e.id);
  // In chunks: the history is up to 200 entries, past D1's 100-parameter
  // cap for one statement.
  const itemRows = await readInChunks(entryIds, (chunk) =>
    database
      .select({ itemId: outfitEntryItems.itemId })
      .from(outfitEntryItems)
      .where(inArray(outfitEntryItems.entryId, chunk)),
  );
  const wearCounts = new Map<string, number>();
  for (const row of itemRows) {
    wearCounts.set(row.itemId, (wearCounts.get(row.itemId) ?? 0) + 1);
  }
  const topItemIds = topByCount(wearCounts, 5).map(([itemId]) => itemId);
  const nameById = await garmentNamesByIds(database, topItemIds);

  const [followers, following, runCount] = await Promise.all([
    followerCount(userId),
    followingCount(userId),
    // `runs_user_started` leads with the user, so this counts from the
    // index alone — the same shape the follow counts take.
    countWhere(database, runs, eq(runs.userId, userId)),
  ]);

  return {
    userId,
    username: profile?.username ?? undefined,
    cityLabel: profile?.cityLabel ?? undefined,
    thermalLevel: profile?.thermalLevel ?? undefined,
    followerCount: followers,
    followingCount: following,
    entryCount: profileEntries.length,
    runCount,
    coverage: bandsAscending(tally),
    mostWornItems: topItemIds.map((itemId) => ({
      itemId,
      name: nameById.get(itemId) ?? "[removed item]",
      wearCount: wearCounts.get(itemId) ?? 0,
    })),
    recentEntries: profileEntries.slice(0, RECENT_LIMIT).map((e) => ({
      entryId: e.id,
      createdAt: e.createdAt,
      verdict: e.verdict,
    })),
  };
}

export interface OtherProfile {
  userId: string;
  username: string | null;
  cityLabel: string | null;
  recentPublicEntries: {
    entryId: string;
    createdAt: number;
    verdict: number | null;
    caption: string | null;
  }[];
}

/**
The runner as `viewerId` may see them, or no row: a banned runner, one in a
block pair with the viewer, or one whose profile the viewer reported (D-68)
answers with nothing — the same answer as a runner who does not exist, so
the page reads as not found rather than as "there is someone here you may
not see". All of it in SQL, a primary-key read plus index probes. A
statement so a test can read its plan.
*/
export function visibleRunnerStatement(
  database: DrizzleD1Database,
  userId: string,
  viewerId: string,
) {
  return runnersVisibleTo(
    database,
    viewerId,
    eq(userProfiles.userId, userId),
  ).limit(1);
}

/**
H's entries: the runner's, through the viewer-aware form of the one
visibility rule, so what the viewer reported drops out too — in SQL and
ahead of the `LIMIT` (FEED-7, D-107/D-108).

Rhyme with consensus.ts's function of the same name, not a copy: this one
is a single runner's most-recent page — ordered, LIMITed. Consensus's is
every runner's unbounded window for an aggregate, deliberately unordered
and un-LIMITed (see that file's module doc: a LIMIT there hid real
matches behind a busy afternoon elsewhere, PR #102 review). Merging the
two callers would recouple exactly what that PR pulled apart — but the
`select`/`from` skeleton under both is shared once, via
`outfitEntriesSelect` (entries-query.ts), rather than retyped here.
*/
export function recentPublicEntriesStatement(
  database: DrizzleD1Database,
  userId: string,
  viewerId: string,
) {
  return outfitEntriesSelect(
    database,
    {
      id: outfitEntries.id,
      createdAt: outfitEntries.createdAt,
      verdict: outfitEntries.verdict,
      caption: outfitEntries.caption,
    },
    and(eq(outfitEntries.userId, userId), publiclyVisibleEntry(viewerId)),
  )
    .orderBy(desc(outfitEntries.createdAt))
    .limit(RECENT_LIMIT);
}

/**
The runner's handle and nothing else, for `/feed/u/$userId`'s redirect —
which needs a name to send the viewer to, not twenty entries to throw
away. The same gate as H, so the redirect never names a runner H would
refuse.
*/
export async function visibleRunnerHandle(
  userId: string,
  viewerId: string,
): Promise<{ username: string | null } | undefined> {
  const [row] = await visibleRunnerStatement(db(), userId, viewerId);
  return row;
}

/**
H v1: public info + recent PUBLIC entries only — no aggregates, and only a
runner `visibleRunnerStatement` lets the viewer see.
*/
export async function otherProfile(
  userId: string,
  viewerId: string,
): Promise<OtherProfile | undefined> {
  const database = db();
  const [profile] = await visibleRunnerStatement(database, userId, viewerId);
  if (!profile) return undefined;

  const entries = await recentPublicEntriesStatement(
    database,
    userId,
    viewerId,
  );

  return {
    userId,
    username: profile.username,
    cityLabel: profile.cityLabel,
    recentPublicEntries: entries.map((e) => ({
      entryId: e.id,
      createdAt: e.createdAt,
      verdict: e.verdict,
      caption: e.caption,
    })),
  };
}

/**
What `/@handle` answers (round 26 #7): the runner who holds it now, the
viewer themself, or a handle somebody used to hold — which says "This
runner changed their name." and never who they are now, because a
redirect would link the old handle to the new one (decision D-56) — or
one whose runner's account was deleted, which says only "This runner
isn't here." (decision D-82).
*/
export type ProfileAtHandle =
  | {
      readonly kind: "runner";
      readonly profile: OtherProfile;
      readonly isFollowing: boolean;
    }
  | { readonly kind: "own" }
  | { readonly kind: "changed" }
  | { readonly kind: "gone" };

/**
`undefined` for a handle nobody has held, and for one whose holder the
viewer may not see (banned, a block either way, or reported by them) — deliberately the same
answer, for the reason `otherProfile` gives.
*/
export async function profileAtHandle(
  viewerId: string,
  handle: string,
): Promise<ProfileAtHandle | undefined> {
  const found = await lookUpHandle(db(), handle);
  if (found?.kind !== "current") return found;
  if (found.userId === viewerId) return { kind: "own" };
  const profile = await otherProfile(found.userId, viewerId);
  if (profile === undefined) return undefined;
  return {
    kind: "runner",
    profile,
    isFollowing: await isFollowing(viewerId, found.userId),
  };
}
