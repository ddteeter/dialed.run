import { describe, expect, it } from "vitest";

import {
  attachKit,
  ForbiddenError,
  getEntryDetail,
  submitVerdict,
} from "../../src/modules/feed/entries";
import { followingFeed } from "../../src/modules/feed/feed";
import { follow } from "../../src/modules/feed/follows";
import { otherProfile } from "../../src/modules/feed/profiles";
import { yourConditionsConsensus } from "../../src/modules/feed/consensus";
import {
  makeEntry,
  makeItem,
  makeObservation,
  makeRun,
  makeUser,
  NOW,
} from "./helpers";

describe("authorization", () => {
  it("refuses to attach a kit to another user's run", async () => {
    const owner = await makeUser();
    const attacker = await makeUser();
    const runId = await makeRun({ userId: owner });

    await expect(
      attachKit({ userId: attacker, runId, itemIds: [] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("only lets the picker use the user's own items", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const runId = await makeRun({ userId: owner });
    const strangersItem = await makeItem({ userId: stranger });

    await expect(
      attachKit({ userId: owner, runId, itemIds: [strangersItem] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("hides a private entry's detail from everyone but its owner", async () => {
    const owner = await makeUser();
    const viewer = await makeUser();
    const runId = await makeRun({ userId: owner });
    const entryId = await makeEntry({ userId: owner, runId, isPublic: false });

    await expect(getEntryDetail(entryId, viewer)).resolves.toBeUndefined();
    await expect(getEntryDetail(entryId, owner)).resolves.toMatchObject({ id: entryId });
    await expect(getEntryDetail(entryId, undefined)).resolves.toBeUndefined();
  });

  it("never shows a private entry in a follower's feed", async () => {
    const author = await makeUser();
    const follower = await makeUser();
    await follow(follower, author);

    const publicRun = await makeRun({ userId: author });
    const privateRun = await makeRun({ userId: author });
    const publicEntry = await makeEntry({
      userId: author,
      runId: publicRun,
      isPublic: true,
      createdAt: NOW,
    });
    await makeEntry({ userId: author, runId: privateRun, isPublic: false, createdAt: NOW + 1 });

    const page = await followingFeed(follower);
    const entryIds = page.items.map((item) => item.entryId);
    expect(entryIds).toContain(publicEntry);
    expect(entryIds).toHaveLength(1);
  });

  it("never shows a private entry on the author's other-profile view", async () => {
    const author = await makeUser();
    const publicRun = await makeRun({ userId: author });
    const privateRun = await makeRun({ userId: author });
    const publicEntry = await makeEntry({ userId: author, runId: publicRun, isPublic: true });
    await makeEntry({ userId: author, runId: privateRun, isPublic: false });

    const profile = await otherProfile(author);
    const entryIds = profile?.recentPublicEntries.map((e) => e.entryId) ?? [];
    expect(entryIds).toEqual([publicEntry]);
  });

  it("never counts a private entry in the consensus aggregate", async () => {
    const author = await makeUser();
    // A location/time no other test in this file touches, so a shared D1
    // instance across `it()` blocks can't spuriously collide cache keys.
    const lat = 61.22;
    const lng = -149.9;
    const privateRun = await makeRun({ userId: author, lat, lng, startedAt: NOW });
    const item = await makeItem({ userId: author, category: "top" });
    await makeEntry({
      userId: author,
      runId: privateRun,
      isPublic: false,
      createdAt: NOW,
      itemIds: [item],
    });
    await makeObservation({ lat, lng, startedAt: NOW, tempC: 10, feelsLikeC: 9 });

    const result = await yourConditionsConsensus(
      { tempC: 10, feelsLikeC: 9, precipMm: 0, condition: "clear", windKph: 5, source: "visualcrossing" },
      NOW,
    );
    expect(result.total).toBe(0);
  });

  it("never shows another viewer a public entry's per-item flags/notes", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const runId = await makeRun({ userId: owner });
    const item = await makeItem({ userId: owner });
    const entryId = await makeEntry({ userId: owner, runId, isPublic: true, itemIds: [item] });
    await submitVerdict({
      userId: owner,
      entryId,
      verdict: 1,
      isPublic: true,
      tags: [],
      itemFlags: [{ itemId: item, flag: "too_much", note: "sweated through it" }],
    });

    const asOwner = await getEntryDetail(entryId, owner);
    expect(asOwner?.items[0]?.flag).toBe("too_much");
    expect(asOwner?.items[0]?.note).toBe("sweated through it");

    const asStranger = await getEntryDetail(entryId, stranger);
    expect(asStranger?.items[0]?.flag).toBeUndefined();
    expect(asStranger?.items[0]?.note).toBeUndefined();

    const asAnonymous = await getEntryDetail(entryId, undefined);
    expect(asAnonymous?.items[0]?.flag).toBeUndefined();
    expect(asAnonymous?.items[0]?.note).toBeUndefined();
  });
});
