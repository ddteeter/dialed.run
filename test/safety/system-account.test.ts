import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { outfitEntries, userProfiles } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { acceptanceOf } from "../../src/modules/account/terms-acceptance";
import {
  confirmedUserId,
  confirmedViewerId,
} from "../../src/modules/auth/terms-gate";
import { recentPublicEntriesStatement } from "../../src/modules/feed/consensus";
import { entryDetailForViewer } from "../../src/modules/feed/entries";
import { followingFeed } from "../../src/modules/feed/feed";
import { follow } from "../../src/modules/feed/follows";
import { visibleRunnerHandle } from "../../src/modules/feed/profiles";
import { publicProfileRead } from "../../src/modules/feed/public-profile";
import { searchRunners } from "../../src/modules/feed/search";
import { worldVisibleEntry } from "../../src/modules/safety";

import { addAccount } from "../feed/helpers";
import {
  makeEntry,
  makeRun,
  makeUser,
  makeVerifiedUser,
  NOW,
  resetSafetyTables,
} from "./helpers";

/**
 * **The smoke account is invisible to runners** (design 193, #533; owner,
 * 2026-11-09): no findable profile, no search result, no counts, and no
 * write another runner would see. Observed through the reads and the gate
 * a runner meets, not the predicates' SQL, as `visibility.test.ts` does
 * for a ban and for leaving.
 *
 * The flag is set here as the owner sets it in production: one `UPDATE`,
 * since no app code writes it.
 */

function core() {
  return drizzle(env.DIALED_CORE);
}

async function markSystem(userId: string): Promise<void> {
  await core()
    .update(userProfiles)
    .set({ systemAccount: true })
    .where(eq(userProfiles.userId, userId));
}

/**
A PUBLIC kit (shared and on the open web) by `author`.
*/
async function publicKit(author: string): Promise<string> {
  const runId = await makeRun({ userId: author });
  const entryId = await makeEntry({ userId: author, runId });
  await core()
    .update(outfitEntries)
    .set({ audience: "world" })
    .where(eq(outfitEntries.id, entryId));
  return entryId;
}

/**
Everywhere `viewer` could meet this kit, and the counts it could move.
*/
async function sightings(viewer: string, entryId: string) {
  const feed = await followingFeed(viewer);
  const counted = await recentPublicEntriesStatement(core(), NOW - 60);
  const openWeb = await core()
    .select({ id: outfitEntries.id })
    .from(outfitEntries)
    .where(worldVisibleEntry());
  return {
    inFeed: feed.items.some((item) => item.entryId === entryId),
    detail: (await entryDetailForViewer(entryId, viewer)) !== undefined,
    counted: counted.some((row) => row.id === entryId),
    openWeb: openWeb.some((row) => row.id === entryId),
  };
}

const SEEN = { inFeed: true, detail: true, counted: true, openWeb: true };
const UNSEEN = { inFeed: false, detail: false, counted: false, openWeb: false };

describe("a system account, to other runners", () => {
  beforeEach(resetSafetyTables);

  it("is in no search, at no H and on no open-web profile", async () => {
    const smoke = await makeVerifiedUser({ username: "smoke_test" });
    await core()
      .update(userProfiles)
      .set({ publicProfile: true })
      .where(eq(userProfiles.userId, smoke));
    const viewer = await makeUser();
    // Findable first, so the flag is what hides it.
    const found = await searchRunners(viewer, "smoke");
    expect(found.map((row) => row.username)).toStrictEqual(["smoke_test"]);
    expect(await visibleRunnerHandle(smoke, viewer)).toMatchObject({
      username: "smoke_test",
    });
    expect(await publicProfileRead("smoke_test", false)).toBeDefined();

    await markSystem(smoke);

    expect(await searchRunners(viewer, "smoke")).toStrictEqual([]);
    expect(await visibleRunnerHandle(smoke, viewer)).toBeUndefined();
    expect(await publicProfileRead("smoke_test", false)).toBeUndefined();
  });

  it("shares a kit nobody sees and nothing counts", async () => {
    const smoke = await makeVerifiedUser();
    const entryId = await publicKit(smoke);
    const viewer = await makeUser();
    await follow(viewer, smoke);
    expect(await sightings(viewer, entryId)).toEqual(SEEN);

    await markSystem(smoke);

    expect(await sightings(viewer, entryId)).toEqual(UNSEEN);
  });

  it("still reads its own kit", async () => {
    const smoke = await makeVerifiedUser();
    const entryId = await publicKit(smoke);
    await markSystem(smoke);
    expect(await entryDetailForViewer(entryId, smoke)).toBeDefined();
  });

  it("hides nobody else", async () => {
    const runner = await makeVerifiedUser({ username: "smoky_runner" });
    const entryId = await publicKit(runner);
    await markSystem(await makeVerifiedUser({ username: "smoke_test" }));
    const viewer = await makeUser();
    await follow(viewer, runner);

    const found = await searchRunners(viewer, "smok");
    expect(found.map((row) => row.username)).toStrictEqual(["smoky_runner"]);
    expect(await sightings(viewer, entryId)).toEqual(SEEN);
  });
});

/**
The terms' version in these tests, as if published.
*/
const PUBLISHED = 3;

async function confirmedRunner(): Promise<string> {
  const userId = await makeVerifiedUser();
  await acceptanceOf(core(), userId, PUBLISHED, 100, "page");
  return userId;
}

describe("a system account, at the verification gate", () => {
  beforeEach(resetSafetyTables);

  it("is refused every write another runner sees, with its own signal", async () => {
    const smoke = await confirmedRunner();
    await markSystem(smoke);
    await expect(
      confirmedUserId(core(), { user: { id: smoke } }, PUBLISHED),
    ).rejects.toMatchObject({
      code: "SYSTEM_ACCOUNT",
      message: "This account can't do that.",
      name: "SystemAccountError",
    });
    // And the Desk's door is not-found for it, as for anyone refused.
    await expect(
      confirmedViewerId(core(), { user: { id: smoke } }, PUBLISHED),
    ).resolves.toBeUndefined();
  });

  it("asks the address first, so an unconfirmed one hears that", async () => {
    const smoke = await makeUser();
    await acceptanceOf(core(), smoke, PUBLISHED, 100, "page");
    await markSystem(smoke);
    await addAccount(smoke, false);
    await expect(
      confirmedUserId(core(), { user: { id: smoke } }, PUBLISHED),
    ).rejects.toMatchObject({ code: "EMAIL_UNCONFIRMED" });
  });

  it("lets an ordinary runner through, and reads only the runner's own flag", async () => {
    await markSystem(await confirmedRunner());
    const runner = await confirmedRunner();
    await expect(
      confirmedUserId(core(), { user: { id: runner } }, PUBLISHED),
    ).resolves.toBe(runner);
  });

  it("lets a runner with no profile row through, as an ordinary runner", async () => {
    const userId = newUlid();
    await addAccount(userId, true);
    await acceptanceOf(core(), userId, PUBLISHED, 100, "page");
    await expect(
      confirmedUserId(core(), { user: { id: userId } }, PUBLISHED),
    ).resolves.toBe(userId);
  });
});
