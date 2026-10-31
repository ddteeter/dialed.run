import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import {
  entryPhotos,
  outfitEntries,
  reports,
  reviewQueue,
  takedownRequests,
  wardrobeItems,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import type { Audience } from "../../src/lib/contracts";
import {
  PHOTO_MATCHES_LIMIT,
  photoMatchesOf,
} from "../../src/modules/safety/photo-matches";
import {
  fileTakedownRequest,
  pendingReviewQueue,
  pendingTakedownRequests,
} from "../../src/modules/safety";
import { oweInCore } from "../queue-fakes";
import {
  deleteAllFrom,
  makeEntry,
  makeRun,
  makeUser,
  resetTables,
} from "../feed/helpers";

/**
 * The takedown review's copy search (D-142, design 146): every photo
 * within the match distance of the subject's, whoever posted it and
 * whoever may see it, nearest first. Rows are written straight to the
 * tables with chosen fingerprints, so a distance is a number the test
 * picked rather than one an encoder happened to produce.
 */

const core = drizzle(env.DIALED_CORE);

const SUBJECT = "0123456789abcdef";

/**
 * `fingerprint` with the bits of `mask` flipped — so exactly as many bits
 * apart as `mask` has set.
 */
function flipped(fingerprint: string, mask: bigint): string {
  return (BigInt(`0x${fingerprint}`) ^ mask).toString(16).padStart(16, "0");
}

/**
Eight bits flipped, one in each byte: the farthest a match may be.
*/
const EIGHT_APART = flipped(SUBJECT, 0x01_02_04_08_10_20_40_80n);
/**
Nine: one more than a match may be.
*/
const NINE_APART = flipped(SUBJECT, 0x01_02_04_08_10_20_40_81n);

async function kit(audience: Audience = "runners", username?: string) {
  const userId = await makeUser(username === undefined ? {} : { username });
  const runId = await makeRun({ userId });
  return makeEntry({ userId, runId, audience });
}

/**
Whose a kit is, as a match names its owner.
*/
async function ownerOf(entryId: string): Promise<string> {
  const [row] = await core
    .select({ userId: outfitEntries.userId })
    .from(outfitEntries)
    .where(eq(outfitEntries.id, entryId));
  if (row === undefined) throw new Error("no kit");
  return row.userId;
}

async function photo(
  entryId: string,
  fingerprint: string | undefined,
  position = 0,
): Promise<string> {
  const id = newUlid();
  await core.insert(entryPhotos).values({
    id,
    entryId,
    photoKey: `entries/x/${entryId}/${id}`,
    position,
    fingerprint,
    screenStatus: "pass",
  });
  return id;
}

async function garment(
  fingerprint: string | undefined,
  userId: string = newUlid(),
): Promise<string> {
  const id = newUlid();
  await core.insert(wardrobeItems).values({
    id,
    userId,
    category: "top",
    name: "Shirt",
    photoKey: fingerprint === undefined ? undefined : `items/x/${id}/v1`,
    photoFingerprint: fingerprint,
    createdAt: 1_757_000_000,
  });
  return id;
}

describe("photoMatchesOf", () => {
  beforeEach(async () => {
    await deleteAllFrom(core, [entryPhotos]);
    await resetTables();
  });

  it("answers an empty map for no subjects", async () => {
    expect(await photoMatchesOf(core, [])).toStrictEqual(new Map());
  });

  it("finds kit and garment photos within the distance, private included, nearest first", async () => {
    const subjectKit = await kit();
    const subject = await photo(subjectKit, SUBJECT);
    const privateKit = await kit("private", "k_lopes");
    const exact = await photo(privateKit, SUBJECT);
    const sharedKit = await kit("runners", "trailjen");
    const farthest = await photo(sharedKit, EIGHT_APART);
    await photo(sharedKit, NINE_APART, 1);
    await photo(sharedKit, undefined, 2);
    // A runner with no profile row has no handle to offer.
    const closetOwner = newUlid();
    const nearGarment = await garment(flipped(SUBJECT, 0b111n), closetOwner);
    await garment(NINE_APART);
    await garment(undefined);

    const found = await photoMatchesOf(core, [
      { subjectType: "photo", subjectId: subject },
    ]);

    // Nearest first across both kinds (round 39 #71), each saying whose.
    expect(found.get(`photo:${subject}`)?.matches).toStrictEqual([
      {
        kind: "kit",
        id: exact,
        photoKey: `entries/x/${privateKit}/${exact}`,
        entryId: privateKit,
        canOpen: false,
        isPrivate: true,
        distance: 0,
        ownerId: await ownerOf(privateKit),
        handle: "k_lopes",
      },
      {
        kind: "garment",
        id: nearGarment,
        photoKey: `items/x/${nearGarment}/v1/card.webp`,
        canOpen: false,
        distance: 3,
        ownerId: closetOwner,
        handle: undefined,
        isPrivate: false,
      },
      {
        kind: "kit",
        id: farthest,
        photoKey: `entries/x/${sharedKit}/${farthest}`,
        entryId: sharedKit,
        canOpen: true,
        isPrivate: false,
        distance: 8,
        ownerId: await ownerOf(sharedKit),
        handle: "trailjen",
      },
    ]);
  });

  it("puts a kit before a garment at the same distance, and names a closet's owner", async () => {
    const subject = await photo(await kit(), SUBJECT);
    const wearer = await makeUser({ username: "maya_runs" });
    const shirt = await garment(flipped(SUBJECT, 1n), wearer);
    const copy = await photo(await kit(), flipped(SUBJECT, 0b11n));

    const found = await photoMatchesOf(core, [
      { subjectType: "photo", subjectId: subject },
    ]);

    expect(
      found
        .get(`photo:${subject}`)
        ?.matches.map((match) => [match.id, match.handle]),
    ).toStrictEqual([
      [shirt, "maya_runs"],
      [copy, expect.stringMatching(/^runner_/u)],
    ]);
    const tied = await photo(await kit(), flipped(SUBJECT, 4n));
    const again = await photoMatchesOf(core, [
      { subjectType: "photo", subjectId: subject },
    ]);
    expect(
      again.get(`photo:${subject}`)?.matches.map((match) => match.id),
    ).toStrictEqual([tied, shirt, copy]);
  });

  it("measures the distance in every digit", async () => {
    const subjectKit = await kit();
    const subject = await photo(subjectKit, SUBJECT);
    // One bit in each of the first eight digits, and eight in the last
    // two: a digit read from the wrong place would count differently.
    const high = flipped(SUBJECT, 0x11_11_11_11_00_00_00_00n);
    const low = flipped(SUBJECT, 0x00_00_00_00_00_00_00_ffn);
    const highId = await photo(await kit(), high);
    const lowId = await photo(await kit(), low);

    const found = await photoMatchesOf(core, [
      { subjectType: "photo", subjectId: subject },
    ]);

    const distances = new Map(
      (found.get(`photo:${subject}`)?.matches ?? []).map((match) => [
        match.id,
        match.distance,
      ]),
    );
    expect(distances).toStrictEqual(
      new Map([
        [highId, 8],
        [lowId, 8],
      ]),
    );
  });

  it("searches a kit by every photo on it, leaving the kit's own out", async () => {
    const other = "fedcba9876543210";
    const subjectKit = await kit();
    await photo(subjectKit, SUBJECT);
    await photo(subjectKit, other, 1);
    // A photo predating fingerprints sits on the kit too, and is skipped.
    await photo(subjectKit, undefined, 2);
    const nearFirst = await photo(await kit(), flipped(SUBJECT, 1n));
    const nearSecond = await photo(await kit(), flipped(other, 3n));

    const found = await photoMatchesOf(core, [
      { subjectType: "entry", subjectId: subjectKit },
    ]);

    expect(
      (found.get(`entry:${subjectKit}`)?.matches ?? []).map((match) => [
        match.id,
        match.distance,
      ]),
    ).toStrictEqual([
      [nearFirst, 1],
      [nearSecond, 2],
    ]);
  });

  it("leaves out only the subject photo, not the rest of its kit", async () => {
    const subjectKit = await kit();
    const subject = await photo(subjectKit, SUBJECT);
    const sibling = await photo(subjectKit, SUBJECT, 1);

    const found = await photoMatchesOf(core, [
      { subjectType: "photo", subjectId: subject },
    ]);

    expect(
      found.get(`photo:${subject}`)?.matches.map((match) => match.id),
    ).toStrictEqual([sibling]);
  });

  it("has nothing to search by for a photo with no fingerprint, or one that is gone", async () => {
    const legacy = await photo(await kit(), undefined);
    await photo(await kit(), SUBJECT);

    const gone = newUlid();
    const found = await photoMatchesOf(core, [
      { subjectType: "photo", subjectId: legacy },
      { subjectType: "photo", subjectId: gone },
    ]);

    expect(found).toStrictEqual(
      new Map([
        [`photo:${legacy}`, { fingerprinted: false, matches: [], isCutOff: false }],
        [`photo:${gone}`, { fingerprinted: false, matches: [], isCutOff: false }],
      ]),
    );
  });

  it("answers each subject apart, in one call", async () => {
    const one = await photo(await kit(), SUBJECT);
    const two = await photo(await kit(), NINE_APART);

    const found = await photoMatchesOf(core, [
      { subjectType: "photo", subjectId: one },
      { subjectType: "photo", subjectId: two },
    ]);

    expect(found).toStrictEqual(
      new Map([
        [`photo:${one}`, { fingerprinted: true, matches: [], isCutOff: false }],
        [`photo:${two}`, { fingerprinted: true, matches: [], isCutOff: false }],
      ]),
    );
  });

  it(`lists at most ${String(PHOTO_MATCHES_LIMIT)} of each kind`, async () => {
    const subject = await photo(await kit(), SUBJECT);
    const copies = await kit();
    for (let index = 0; index <= PHOTO_MATCHES_LIMIT; index += 1) {
      await photo(copies, SUBJECT, index);
      await garment(SUBJECT);
    }

    const found = await photoMatchesOf(core, [
      { subjectType: "photo", subjectId: subject },
    ]);

    const kinds = (found.get(`photo:${subject}`)?.matches ?? []).map(
      (match) => match.kind,
    );
    expect(kinds.filter((kind) => kind === "kit")).toHaveLength(
      PHOTO_MATCHES_LIMIT,
    );
    expect(kinds.filter((kind) => kind === "garment")).toHaveLength(
      PHOTO_MATCHES_LIMIT,
    );
    expect(found.get(`photo:${subject}`)?.isCutOff).toBe(true);
  });

  it("says a list is cut off only when one kind had more than the limit (design 164)", async () => {
    const subject = await photo(await kit(), SUBJECT);
    const copies = await kit();
    for (let index = 0; index < PHOTO_MATCHES_LIMIT; index += 1) {
      await photo(copies, SUBJECT, index);
      await garment(SUBJECT);
    }
    const search = [{ subjectType: "photo" as const, subjectId: subject }];

    const full = await photoMatchesOf(core, search);
    expect(full.get(`photo:${subject}`)?.isCutOff).toBe(false);

    await garment(SUBJECT);
    const over = await photoMatchesOf(core, search);
    expect(over.get(`photo:${subject}`)?.isCutOff).toBe(true);
  });

  it("refuses a stored fingerprint it did not write rather than spell it into SQL", async () => {
    const subject = await photo(await kit(), "' OR 1=1 --");

    await expect(
      photoMatchesOf(core, [{ subjectType: "photo", subjectId: subject }]),
    ).rejects.toThrow();
  });
});

describe("the Review rows that carry them", () => {
  beforeEach(async () => {
    await deleteAllFrom(core, [
      entryPhotos,
      reports,
      reviewQueue,
      takedownRequests,
    ]);
    await resetTables();
  });

  it("puts them on a row an intimate-image report started, and on no other", async () => {
    const reported = await photo(await kit(), SUBJECT);
    const copy = await photo(await kit("private"), SUBJECT);
    const spammy = await photo(await kit(), NINE_APART);
    for (const [subjectId, reason] of [
      [reported, "intimate"],
      [spammy, "spam"],
    ] as const) {
      await core.insert(reports).values({
        id: newUlid(),
        reporterId: await makeUser(),
        subjectType: "photo",
        subjectId,
        reason,
        createdAt: 1_757_000_000,
      });
      await core.insert(reviewQueue).values({
        id: newUlid(),
        subjectType: "photo",
        subjectId,
        source: "reports",
        status: "pending",
        createdAt: 1_757_000_000,
      });
    }

    const queue = await pendingReviewQueue();

    const rowFor = (id: string) => queue.find((row) => row.subjectId === id);
    expect(rowFor(reported)?.photoMatches).toStrictEqual({
      fingerprinted: true,
      matches: [expect.objectContaining({ id: copy, distance: 0 })],
      isCutOff: false,
    });
    expect(rowFor(spammy)?.photoMatches).toBeUndefined();
  });

  it("puts them on a removal request whose link is ours, and none on one that is not", async () => {
    const reported = await kit();
    await photo(reported, SUBJECT);
    const copy = await photo(await kit(), flipped(SUBJECT, 1n));
    const filing = {
      email: "sam@example.com",
      signature: "Sam Runner",
      description: "",
      isAttested: true as const,
      attempt: "token",
      remoteIp: "203.0.113.9",
      isLimited: false,
    };
    const deps = {
      verify: () => Promise.resolve({ ok: true }),
      owe: oweInCore,
    };
    await fileTakedownRequest(
      core,
      {
        ...filing,
        location: `https://dialed.run/feed/entry/${reported}`,
        idempotencyKey: newUlid(),
      },
      deps,
      1_800_000_000,
    );
    await fileTakedownRequest(
      core,
      { ...filing, location: "a forum somewhere", idempotencyKey: newUlid() },
      deps,
      1_800_000_001,
    );

    const [ours, theirs] = await pendingTakedownRequests(core, 1_800_000_000);

    expect(ours?.photoMatches).toStrictEqual({
      fingerprinted: true,
      matches: [expect.objectContaining({ id: copy, distance: 1 })],
      isCutOff: false,
    });
    expect(theirs?.location).toBe("a forum somewhere");
    expect(theirs?.photoMatches).toBeUndefined();
  });
});
