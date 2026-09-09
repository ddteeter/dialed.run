import { beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";

import {
  notifications,
  outfitEntries,
  outfitEntryItems,
  runs,
  wardrobeItems,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import {
  attachKit,
  entryDetailForViewer,
  ForbiddenError,
  getEntryDetail,
  itemBandWearStat,
  recordVerdictPrompted,
  shouldPromptForVerdict,
  submitVerdict,
  verdictBandCounts,
} from "../../src/modules/feed/entries";
import { toggleUsefulReaction } from "../../src/modules/feed/reactions";
import {
  makeItem,
  makeObservation,
  makeRun,
  makeUser,
  resetTables,
  NOW,
} from "./helpers";

/**
 * The write path's refusals and the detail read's fallbacks.
 *
 * Seventy-five mutants lived here, and most of them are the sentences a
 * refusal carries or the branch that decides to refuse at all. An
 * authorization check that says nothing is one a caller cannot distinguish
 * from a bug; one that never fires is not a check.
 */

function db() {
  return drizzle(env.DIALED_CORE);
}

beforeEach(async () => {
  await resetTables();
});

describe("attachKit refuses what is not the caller's", () => {
  it("says which thing was not found", async () => {
    await expect(
      attachKit({ userId: await makeUser(), runId: newUlid(), itemIds: [] }),
    ).rejects.toThrow(/run not found/);
  });

  it("refuses another runner's run, and says so", async () => {
    const mine = await makeUser();
    const theirs = await makeUser();
    const runId = await makeRun({ userId: theirs });

    await expect(
      attachKit({ userId: mine, runId, itemIds: [] }),
    ).rejects.toThrow(/another user's run/);
  });

  it("refuses a run that already carries someone else's entry", async () => {
    // The run and the entry can disagree about their owner only if
    // something has gone wrong upstream; refusing is what stops a kit
    // being attributed to the wrong runner.
    const owner = await makeUser();
    const other = await makeUser();
    const runId = await makeRun({ userId: owner });
    await attachKit({ userId: owner, runId, itemIds: [] });
    await db()
      .update(outfitEntries)
      .set({ userId: other })
      .where(eq(outfitEntries.runId, runId));

    await expect(
      attachKit({ userId: owner, runId, itemIds: [] }),
    ).rejects.toThrow(/another user's entry/);
  });

  it("refuses a kit containing someone else's garment", async () => {
    const mine = await makeUser();
    const theirs = await makeUser();
    const runId = await makeRun({ userId: mine });
    const notMine = await makeItem({ userId: theirs });

    await expect(
      attachKit({ userId: mine, runId, itemIds: [notMine] }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("refuses a garment that does not exist", async () => {
    const userId = await makeUser();
    const runId = await makeRun({ userId });

    await expect(
      attachKit({ userId, runId, itemIds: [newUlid()] }),
    ).rejects.toThrow(/own items/);
  });
});

describe("attachKit follows the runner's sharing default", () => {
  it("stamps the entry in epoch seconds", async () => {
    // The feed and every band window order by this column. A millisecond
    // value pins the entry to the top of the feed for the next thousand
    // years.
    const userId = await makeUser();
    const runId = await makeRun({ userId });
    const before = Math.floor(Date.now() / 1000);

    const entryId = await attachKit({ userId, runId, itemIds: [] });

    const [entry] = await db()
      .select()
      .from(outfitEntries)
      .where(eq(outfitEntries.id, entryId));
    expect(entry?.createdAt).toBeGreaterThanOrEqual(before - 5);
    expect(entry?.createdAt).toBeLessThanOrEqual(before + 5);
  });

  it("shares by default when the profile says to", async () => {
    const userId = await makeUser({ shareDefault: true });
    const runId = await makeRun({ userId });

    const entryId = await attachKit({ userId, runId, itemIds: [] });

    const [entry] = await db()
      .select()
      .from(outfitEntries)
      .where(eq(outfitEntries.id, entryId));
    expect(entry?.isPublic).toBe(true);
  });

  it("keeps an entry private when the profile says to", async () => {
    // The per-user default is a privacy setting; ignoring it publishes
    // something the runner asked to keep to themselves.
    const userId = await makeUser({ shareDefault: false });
    const runId = await makeRun({ userId });

    const entryId = await attachKit({ userId, runId, itemIds: [] });

    const [entry] = await db()
      .select()
      .from(outfitEntries)
      .where(eq(outfitEntries.id, entryId));
    expect(entry?.isPublic).toBe(false);
  });

  it("shares by default when there is no profile row at all", async () => {
    const userId = newUlid();
    const runId = await makeRun({ userId });

    const entryId = await attachKit({ userId, runId, itemIds: [] });

    const [entry] = await db()
      .select()
      .from(outfitEntries)
      .where(eq(outfitEntries.id, entryId));
    expect(entry?.isPublic).toBe(true);
  });
});

describe("submitVerdict refuses what is not the caller's", () => {
  it("says the entry was not found", async () => {
    await expect(
      submitVerdict({
        userId: await makeUser(),
        entryId: newUlid(),
        verdict: 0,
        isPublic: true,
        tags: [],
        itemFlags: [],
      }),
    ).rejects.toThrow(/entry not found/);
  });

  it("refuses another runner's entry, and says so", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const runId = await makeRun({ userId: owner });
    const entryId = await attachKit({ userId: owner, runId, itemIds: [] });

    await expect(
      submitVerdict({
        userId: other,
        entryId,
        verdict: 0,
        isPublic: true,
        tags: [],
        itemFlags: [],
      }),
    ).rejects.toThrow(/another user's entry/);
  });
});

async function ownEntry(): Promise<{
  userId: string;
  entryId: string;
  itemId: string;
}> {
  const userId = await makeUser();
  const runId = await makeRun({ userId });
  const itemId = await makeItem({ userId });
  const entryId = await attachKit({ userId, runId, itemIds: [itemId] });
  return { userId, entryId, itemId };
}

describe("submitVerdict writes the whole submission or none of it", () => {

  it("records the tags it was given, replacing the previous ones", async () => {
    const { userId, entryId } = await ownEntry();

    await submitVerdict({
      userId,
      entryId,
      verdict: -1,
      isPublic: true,
      tags: ["cold_first_mile"],
      itemFlags: [],
    });
    const first = await getEntryDetail(entryId, userId);
    expect(first?.tags).toStrictEqual(["cold_first_mile"]);

    await submitVerdict({
      userId,
      entryId,
      verdict: 1,
      isPublic: true,
      tags: ["hands_sweaty"],
      itemFlags: [],
    });
    const second = await getEntryDetail(entryId, userId);
    expect(second?.tags).toStrictEqual(["hands_sweaty"]);
  });

  it("clears the tags when none are given", async () => {
    const { userId, entryId } = await ownEntry();
    await submitVerdict({
      userId,
      entryId,
      verdict: 0,
      isPublic: true,
      tags: ["cold_first_mile"],
      itemFlags: [],
    });

    await submitVerdict({
      userId,
      entryId,
      verdict: 0,
      isPublic: true,
      tags: [],
      itemFlags: [],
    });

    const detail = await getEntryDetail(entryId, userId);
    expect(detail?.tags).toStrictEqual([]);
  });

  it("records a per-item flag and note, and clears them again", async () => {
    const { userId, entryId, itemId } = await ownEntry();

    await submitVerdict({
      userId,
      entryId,
      verdict: 0,
      isPublic: true,
      tags: [],
      itemFlags: [{ itemId, flag: "too_much", note: "Hands cooked" }],
    });
    const flagged = await getEntryDetail(entryId, userId);
    expect(flagged?.items[0]).toMatchObject({
      flag: "too_much",
      note: "Hands cooked",
    });

    await submitVerdict({
      userId,
      entryId,
      verdict: 0,
      isPublic: true,
      tags: [],
      itemFlags: [{ itemId }],
    });
    const cleared = await getEntryDetail(entryId, userId);
    expect(cleared?.items[0]?.flag).toBeUndefined();
    expect(cleared?.items[0]?.note).toBeUndefined();
  });

  it("ignores a flag for an item the entry does not contain", async () => {
    // The flags arrive from a form; which are legitimate depends on what
    // the entry holds, and a stale client must not be able to flag someone
    // else's garment.
    const { userId, entryId } = await ownEntry();
    const notInKit = await makeItem({ userId, name: "Not worn" });

    await submitVerdict({
      userId,
      entryId,
      verdict: 0,
      isPublic: true,
      tags: [],
      itemFlags: [{ itemId: notInKit, flag: "not_enough" }],
    });

    const rows = await db()
      .select()
      .from(outfitEntryItems)
      .where(eq(outfitEntryItems.entryId, entryId));
    expect(rows.every((row) => row.flag === null)).toBe(true);
  });

  it("clears a caption back to nothing", async () => {
    const { userId, entryId } = await ownEntry();
    await submitVerdict({
      userId,
      entryId,
      verdict: 0,
      isPublic: true,
      tags: [],
      itemFlags: [],
      caption: "Windy",
    });
    const withCaption = await getEntryDetail(entryId, userId);
    expect(withCaption?.caption).toBe("Windy");

    await submitVerdict({
      userId,
      entryId,
      verdict: 0,
      isPublic: true,
      tags: [],
      itemFlags: [],
    });

    const cleared = await getEntryDetail(entryId, userId);
    expect(cleared?.caption).toBeUndefined();
  });
});

describe("getEntryDetail copes with what is missing", () => {
  it("names a garment that has since been deleted, and gives it a category", async () => {
    // The category drives which icon and group the row renders in. A blank
    // one is a card that cannot be laid out.
    const userId = await makeUser();
    const runId = await makeRun({ userId });
    const itemId = await makeItem({ userId, name: "Doomed", category: "top" });
    const entryId = await attachKit({ userId, runId, itemIds: [itemId] });
    await db().delete(wardrobeItems).where(eq(wardrobeItems.id, itemId));

    const detail = await getEntryDetail(entryId, userId);

    expect(detail?.items[0]).toMatchObject({
      name: "[removed item]",
      category: "accessory",
    });
  });

  it("shows per-item flags to the owner and to nobody else", async () => {
    // The flag is the runner's own note to themselves. It is not part of
    // what sharing an entry shares.
    const userId = await makeUser();
    const viewer = await makeUser();
    const runId = await makeRun({ userId });
    const itemId = await makeItem({ userId });
    const entryId = await attachKit({ userId, runId, itemIds: [itemId] });
    await submitVerdict({
      userId,
      entryId,
      verdict: 0,
      isPublic: true,
      tags: [],
      itemFlags: [{ itemId, flag: "too_much", note: "Private note" }],
    });

    const asOwner = await getEntryDetail(entryId, userId);
    const asStranger = await getEntryDetail(entryId, viewer);

    expect(asOwner?.items[0]?.note).toBe("Private note");
    expect(asStranger?.items[0]?.note).toBeUndefined();
    expect(asStranger?.items[0]?.flag).toBeUndefined();
  });

  it("answers with nothing for an entry that does not exist", async () => {
    expect(await getEntryDetail(newUlid(), await makeUser())).toBeUndefined();
  });
});

async function unratedEntry(): Promise<{ userId: string; entryId: string }> {
  const userId = await makeUser();
  const runId = await makeRun({ userId });
  const entryId = await attachKit({ userId, runId, itemIds: [] });
  return { userId, entryId };
}

describe("the verdict prompt", () => {

  it("prompts the owner of an entry with no verdict", async () => {
    const { userId, entryId } = await unratedEntry();
    expect(await shouldPromptForVerdict(userId, entryId)).toBe(true);
  });

  it("does not prompt about an entry that does not exist", async () => {
    expect(
      await shouldPromptForVerdict(await makeUser(), newUlid()),
    ).toBe(false);
  });

  it("does not prompt anyone but the owner", async () => {
    const { entryId } = await unratedEntry();
    expect(await shouldPromptForVerdict(await makeUser(), entryId)).toBe(false);
  });

  it("does not prompt once a verdict is in", async () => {
    const { userId, entryId } = await unratedEntry();
    await submitVerdict({
      userId,
      entryId,
      verdict: 0,
      isPublic: true,
      tags: [],
      itemFlags: [],
    });

    expect(await shouldPromptForVerdict(userId, entryId)).toBe(false);
  });

  it("does not prompt twice about the same entry", async () => {
    // Law 1: the notification insert is idempotent, and the prompt is what
    // stops a second one being offered at all.
    const { userId, entryId } = await unratedEntry();

    await recordVerdictPrompted(userId, entryId);

    expect(await shouldPromptForVerdict(userId, entryId)).toBe(false);
    const rows = await db()
      .select()
      .from(notifications)
      .where(eq(notifications.subjectId, entryId));
    expect(rows).toHaveLength(1);
  });

  it("records the prompt once even when asked twice", async () => {
    const { userId, entryId } = await unratedEntry();

    await recordVerdictPrompted(userId, entryId);
    await recordVerdictPrompted(userId, entryId);

    const rows = await db()
      .select()
      .from(notifications)
      .where(eq(notifications.subjectId, entryId));
    expect(rows).toHaveLength(1);
  });
});

async function ratedEntryInBand(params: {
  userId: string;
  lat: number;
  feelsLikeC: number;
  verdict: number;
  itemIds?: string[];
}): Promise<string> {
  const runId = await makeRun({
    userId: params.userId,
    lat: params.lat,
    lng: -93.27,
  });
  await makeObservation({
    lat: params.lat,
    lng: -93.27,
    startedAt: NOW,
    tempC: params.feelsLikeC + 2,
    feelsLikeC: params.feelsLikeC,
  });
  const entryId = await attachKit({
    userId: params.userId,
    runId,
    itemIds: params.itemIds ?? [],
  });
  await submitVerdict({
    userId: params.userId,
    entryId,
    verdict: params.verdict,
    isPublic: true,
    tags: [],
    itemFlags: [],
  });
  return entryId;
}

describe("band statistics", () => {

  it("answers with zeroes for a runner with no history", async () => {
    expect(
      await itemBandWearStat(await makeUser(), newUlid(), 0),
    ).toStrictEqual({ worn: 0, total: 0 });
  });

  it("answers with zeroes when nothing was logged in that band", async () => {
    const userId = await makeUser();
    const itemId = await makeItem({ userId });
    await ratedEntryInBand({
      userId,
      lat: 61.11,
      feelsLikeC: 20,
      verdict: 0,
      itemIds: [itemId],
    });

    expect(await itemBandWearStat(userId, itemId, -20)).toStrictEqual({
      worn: 0,
      total: 0,
    });
  });

  it("counts how often an item was worn in a band, out of the band's runs", async () => {
    const userId = await makeUser();
    const worn = await makeItem({ userId, name: "Worn" });
    const spare = await makeItem({ userId, name: "Spare" });
    await ratedEntryInBand({
      userId,
      lat: 62.11,
      feelsLikeC: 3,
      verdict: 0,
      itemIds: [worn],
    });
    await ratedEntryInBand({
      userId,
      lat: 62.12,
      feelsLikeC: 3,
      verdict: 0,
      itemIds: [spare],
    });

    const stat = await itemBandWearStat(userId, worn, 0);

    expect(stat.total).toBe(2);
    expect(stat.worn).toBe(1);
  });

  it("counts verdicts by band, on the −2..+2 scale", async () => {
    const userId = await makeUser();
    await ratedEntryInBand({ userId, lat: 63.11, feelsLikeC: 3, verdict: -1 });
    await ratedEntryInBand({ userId, lat: 63.12, feelsLikeC: 3, verdict: 0 });
    await ratedEntryInBand({ userId, lat: 63.13, feelsLikeC: 3, verdict: 0 });

    const counts = await verdictBandCounts(userId, 0);

    expect(counts[-1]).toBe(1);
    expect(counts[0]).toBe(2);
    expect(counts[2]).toBe(0);
  });

  it("leaves an entry out of its own comparison", async () => {
    // The verdict screen shows "how you usually do in this band" beside
    // the verdict being entered; counting the entry itself makes the
    // comparison partly a reflection.
    const userId = await makeUser();
    const excluded = await ratedEntryInBand({
      userId,
      lat: 64.11,
      feelsLikeC: 3,
      verdict: 2,
    });
    await ratedEntryInBand({ userId, lat: 64.12, feelsLikeC: 3, verdict: 0 });

    const counts = await verdictBandCounts(userId, 0, excluded);

    expect(counts[2]).toBe(0);
    expect(counts[0]).toBe(1);
  });

  it("counts nothing from another band", async () => {
    const userId = await makeUser();
    await ratedEntryInBand({ userId, lat: 65.11, feelsLikeC: 25, verdict: 0 });

    const counts = await verdictBandCounts(userId, 0);

    expect(Object.values(counts).every((count) => count === 0)).toBe(true);
  });
});

describe("getEntryDetail says what the card shows", () => {
  it("carries the author, the verdict, the conditions and the garment's own fields", async () => {
    // Each of these has a fallback beside it, and a fallback that fires
    // when it should not is a card that shows nothing where something was
    // recorded.
    const userId = await makeUser({ displayName: "Dee" });
    const runId = await makeRun({ userId, lat: 66.11, lng: -93.27 });
    await makeObservation({
      lat: 66.11,
      lng: -93.27,
      startedAt: NOW,
      tempC: 5,
      feelsLikeC: 3,
    });
    const itemId = await makeItem({ userId, name: "Rover", layer: "mid" });
    await db()
      .update(wardrobeItems)
      .set({ brand: "Janji" })
      .where(eq(wardrobeItems.id, itemId));
    const entryId = await attachKit({ userId, runId, itemIds: [itemId] });
    await submitVerdict({
      userId,
      entryId,
      verdict: -2,
      isPublic: true,
      tags: [],
      itemFlags: [],
    });

    const detail = await getEntryDetail(entryId, userId);

    expect(detail?.authorDisplayName).toBe("Dee");
    expect(detail?.verdict).toBe(-2);
    expect(detail?.conditions?.feelsLikeC).toBe(3);
    expect(detail?.items[0]).toMatchObject({
      name: "Rover",
      brand: "Janji",
      layer: "mid",
    });
  });

  it("copes with an author who has no profile row", async () => {
    const userId = newUlid();
    const runId = await makeRun({ userId });
    const entryId = await attachKit({ userId, runId, itemIds: [] });

    const detail = await getEntryDetail(entryId, userId);

    expect(detail?.authorDisplayName).toBeUndefined();
  });

  it("answers with nothing when the run behind the entry is gone", async () => {
    const userId = await makeUser();
    const runId = await makeRun({ userId });
    const entryId = await attachKit({ userId, runId, itemIds: [] });
    await db().delete(runs).where(eq(runs.id, runId));

    expect(await getEntryDetail(entryId, userId)).toBeUndefined();
  });
});

describe("the band windows leave out what they cannot place", () => {
  it("does not count an entry whose conditions were never resolved", async () => {
    // A run with no observation cannot be placed in a band. Counting it
    // anyway puts it in whichever band the caller asked about.
    const userId = await makeUser();
    const runId = await makeRun({ userId, lat: 67.11, lng: -93.27 });
    const entryId = await attachKit({ userId, runId, itemIds: [] });
    await submitVerdict({
      userId,
      entryId,
      verdict: 0,
      isPublic: true,
      tags: [],
      itemFlags: [],
    });

    const counts = await verdictBandCounts(userId, 0);
    const stat = await itemBandWearStat(userId, newUlid(), 0);

    expect(counts[0]).toBe(0);
    expect(stat).toStrictEqual({ worn: 0, total: 0 });
  });
});

describe("the verdict prompt notification", () => {
  it("says what it is about, stamped in epoch seconds", async () => {
    const userId = await makeUser();
    const runId = await makeRun({ userId });
    const entryId = await attachKit({ userId, runId, itemIds: [] });
    const before = Math.floor(Date.now() / 1000);

    await recordVerdictPrompted(userId, entryId);

    const [row] = await db()
      .select()
      .from(notifications)
      .where(eq(notifications.subjectId, entryId));
    expect(row?.body).toMatch(/verdict/i);
    expect(row?.createdAt).toBeGreaterThanOrEqual(before - 5);
    expect(row?.createdAt).toBeLessThanOrEqual(before + 5);
  });
});

describe("entryDetailForViewer", () => {
  it("folds the useful count and the viewer's own reaction into the card", async () => {
    const owner = await makeUser();
    const reactor = await makeUser();
    const runId = await makeRun({ userId: owner });
    const entryId = await attachKit({ userId: owner, runId, itemIds: [] });
    await toggleUsefulReaction(entryId, reactor);

    const asReactor = await entryDetailForViewer(entryId, reactor);
    const asOwner = await entryDetailForViewer(entryId, owner);

    expect(asReactor?.usefulCount).toBe(1);
    expect(asReactor?.viewerHasReacted).toBe(true);
    expect(asOwner?.viewerHasReacted).toBe(false);
  });

  it("answers a signed-out visitor without asking about their reactions", async () => {
    // There is no viewer to have reacted, and asking with an undefined id
    // is a query that can only answer wrongly.
    const owner = await makeUser();
    const runId = await makeRun({ userId: owner });
    const entryId = await attachKit({ userId: owner, runId, itemIds: [] });

    const detail = await entryDetailForViewer(entryId, undefined);

    expect(detail?.viewerHasReacted).toBe(false);
    expect(detail?.usefulCount).toBe(0);
  });

  it("answers with nothing for an entry that does not exist", async () => {
    // And without the counts: a card built around a missing entry is
    // worse than no card.
    expect(
      await entryDetailForViewer(newUlid(), await makeUser()),
    ).toBeUndefined();
  });
});
