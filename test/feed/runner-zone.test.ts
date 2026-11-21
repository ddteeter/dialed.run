import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import { userProfiles } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { getEntryDetail } from "../../src/modules/feed/entries/entries";
import { followingFeed } from "../../src/modules/feed/following/feed";
import { follow } from "../../src/modules/feed/following/follows";
import { makeEntry, makeRun, makeUser, makeVerifiedUser, NOW } from "./helpers";

/**
 * #925: a run with no zone of its own reads its day and clock in its
 * runner's saved place, so the feed and the entry detail carry the
 * author's zone beside each entry, and never the viewer's.
 */

async function savePlaceZone(userId: string, timeZone: string): Promise<void> {
  await drizzle(env.DIALED_CORE)
    .update(userProfiles)
    .set({ timeZone })
    .where(eq(userProfiles.userId, userId));
}

async function sharedEntryBy(author: string): Promise<string> {
  const runId = await makeRun({ userId: author });
  return makeEntry({
    userId: author,
    runId,
    audience: "runners",
    createdAt: NOW,
  });
}

describe("the author's saved zone rides with each entry (#925)", () => {
  it("is on a followed runner's feed card, and not the viewer's zone", async () => {
    const author = await makeVerifiedUser();
    const viewer = await makeUser();
    await savePlaceZone(author, "America/Chicago");
    await savePlaceZone(viewer, "Asia/Tokyo");
    await follow(viewer, author);
    const entryId = await sharedEntryBy(author);

    const page = await followingFeed(viewer);

    const item = page.items.find((candidate) => candidate.entryId === entryId);
    expect(item?.runnerZone).toBe("America/Chicago");
  });

  it("is none on the card when the author has saved no place", async () => {
    const author = await makeVerifiedUser();
    const viewer = await makeUser();
    await follow(viewer, author);
    const entryId = await sharedEntryBy(author);

    const page = await followingFeed(viewer);

    const item = page.items.find((candidate) => candidate.entryId === entryId);
    expect(item).toBeDefined();
    expect(item?.runnerZone).toBeUndefined();
  });

  it("is on the entry detail, for a viewer in another zone", async () => {
    const author = await makeVerifiedUser();
    const viewer = await makeUser();
    await savePlaceZone(author, "America/Chicago");
    await savePlaceZone(viewer, "Asia/Tokyo");
    const entryId = await sharedEntryBy(author);

    const detail = await getEntryDetail(entryId, viewer);

    expect(detail?.runnerZone).toBe("America/Chicago");
  });

  it("is none on the entry detail when the author has saved no place", async () => {
    const author = await makeVerifiedUser();
    const entryId = await sharedEntryBy(author);

    const detail = await getEntryDetail(entryId, author);

    expect(detail).toBeDefined();
    expect(detail?.runnerZone).toBeUndefined();
  });
});
