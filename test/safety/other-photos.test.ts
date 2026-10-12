import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import {
  entryPhotos,
  moderationActions,
  outfitEntries,
  reports,
  reviewQueue,
  takedownRequests,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import {
  fileTakedownRequest,
  pendingReviewQueue,
  pendingTakedownRequests,
} from "../../src/modules/safety";
import {
  OTHER_PHOTOS_LIMIT,
  otherPhotosOf,
  otherPhotosQuery,
} from "../../src/modules/safety/other-photos";

import { makeEntry, makeRun, makeUser, resetSafetyTables } from "./helpers";
import { oweInCore } from "../queue-fakes";

/**
 * D-117 (R-145 c): a Review row about an intimate image lists the same
 * runner's other photos — the effort on copies, made by a person, since
 * nothing hashes photos.
 */
function core() {
  return drizzle(env.DIALED_CORE);
}

const NOW = 1_800_000_000;

async function kit(
  userId: string,
  createdAt: number,
  audience: "runners" | "private" = "runners",
): Promise<string> {
  const runId = await makeRun({ userId });
  return makeEntry({ userId, runId, createdAt, audience });
}

async function photo(entryId: string, position = 0): Promise<string> {
  const id = newUlid();
  await core()
    .insert(entryPhotos)
    .values({
      id,
      entryId,
      photoKey: `entries/x/${entryId}/${id}.jpg`,
      position,
      screenStatus: "pass",
    });
  return id;
}

function ids(photos: readonly { id: string }[] | undefined) {
  return photos?.map((row) => row.id);
}

beforeEach(async () => {
  await resetSafetyTables();
  await core().delete(takedownRequests);
});

describe("otherPhotosOf", () => {
  it("lists the runner's other photos, newest kit first, in each kit's order, and nobody else's", async () => {
    const runner = await makeUser();
    const older = await kit(runner, NOW - 100);
    const newer = await kit(runner, NOW);
    const reported = await photo(older, 0);
    const sameKit = await photo(older, 1);
    const second = await photo(newer, 1);
    const first = await photo(newer, 0);
    await photo(await kit(await makeUser(), NOW + 1));

    const found = await otherPhotosOf(core(), [
      { subjectType: "photo", subjectId: reported },
    ]);

    // The reported photo is left out; its kit's other photo is a copy
    // candidate like any other.
    expect(found.get(`photo:${reported}`)).toStrictEqual([
      {
        id: first,
        entryId: newer,
        photoKey: `entries/x/${newer}/${first}.jpg`,
      },
      {
        id: second,
        entryId: newer,
        photoKey: `entries/x/${newer}/${second}.jpg`,
      },
      {
        id: sameKit,
        entryId: older,
        photoKey: `entries/x/${older}/${sameKit}.jpg`,
      },
    ]);
  });

  it("lists a private kit's photos too: the owner's call on PR #188", async () => {
    const runner = await makeUser();
    const reported = await photo(await kit(runner, NOW));
    const privately = await photo(await kit(runner, NOW - 1, "private"));

    const found = await otherPhotosOf(core(), [
      { subjectType: "photo", subjectId: reported },
    ]);

    // A copy posted privately is still a copy; the privacy policy says an
    // operator may see it for this check (PR #182).
    expect(ids(found.get(`photo:${reported}`))).toStrictEqual([privately]);
  });

  it("leaves out a reported kit's own photos, which its row already shows", async () => {
    const runner = await makeUser();
    const reported = await kit(runner, NOW);
    await photo(reported, 0);
    await photo(reported, 1);
    const elsewhere = await photo(await kit(runner, NOW - 1));

    const found = await otherPhotosOf(core(), [
      { subjectType: "entry", subjectId: reported },
    ]);

    expect(ids(found.get(`entry:${reported}`))).toStrictEqual([elsewhere]);
  });

  it("leaves out a kit already removed", async () => {
    const runner = await makeUser();
    const reported = await photo(await kit(runner, NOW));
    const removedKit = await kit(runner, NOW - 1);
    await photo(removedKit);
    await core()
      .update(outfitEntries)
      .set({ moderationStatus: "removed" })
      .where(eq(outfitEntries.id, removedKit));
    const hiddenKit = await kit(runner, NOW - 2);
    const hidden = await photo(hiddenKit);
    await core()
      .update(outfitEntries)
      .set({ moderationStatus: "hidden_pending_review" })
      .where(eq(outfitEntries.id, hiddenKit));

    const found = await otherPhotosOf(core(), [
      { subjectType: "photo", subjectId: reported },
    ]);

    // Hidden is not removed: a copy someone else reported is still one.
    expect(ids(found.get(`photo:${reported}`))).toStrictEqual([hidden]);
  });

  it(`stops at ${String(OTHER_PHOTOS_LIMIT)}, keeping the newest`, async () => {
    const runner = await makeUser();
    const reported = await photo(await kit(runner, NOW + 1000));
    const posted: string[] = [];
    for (let n = 0; n <= OTHER_PHOTOS_LIMIT; n += 1) {
      posted.push(await photo(await kit(runner, NOW + n)));
    }

    const found = await otherPhotosOf(core(), [
      { subjectType: "photo", subjectId: reported },
    ]);

    expect(OTHER_PHOTOS_LIMIT).toBe(12);
    expect(ids(found.get(`photo:${reported}`))).toStrictEqual(
      posted.toReversed().slice(0, OTHER_PHOTOS_LIMIT),
    );
  });

  it("answers each subject apart, and an empty list for one with nothing else or nobody known", async () => {
    const one = await makeUser();
    const lone = await kit(one, NOW);
    await photo(lone);
    const two = await makeUser();
    const twosPhoto = await photo(await kit(two, NOW));
    const twosOther = await photo(await kit(two, NOW - 1));
    const missing = newUlid();

    const found = await otherPhotosOf(core(), [
      { subjectType: "entry", subjectId: lone },
      { subjectType: "photo", subjectId: twosPhoto },
      { subjectType: "photo", subjectId: missing },
    ]);

    expect(found.size).toBe(3);
    expect(found.get(`entry:${lone}`)).toStrictEqual([]);
    expect(ids(found.get(`photo:${twosPhoto}`))).toStrictEqual([twosOther]);
    // No row and no audit row: nobody is known, so nothing is listed.
    expect(found.get(`photo:${missing}`)).toStrictEqual([]);
  });

  it("still finds the runner of a subject the Desk has deleted, from its audit row", async () => {
    const runner = await makeUser();
    const goneKit = await kit(runner, NOW);
    const gonePhoto = await photo(goneKit);
    const other = await photo(await kit(runner, NOW - 1));
    await photo(await kit(await makeUser(), NOW));
    // What a Remove leaves: the rows gone, the audit row naming the owner.
    for (const [subjectType, subjectId] of [
      ["photo", gonePhoto],
      ["entry", goneKit],
    ] as const) {
      await core().insert(moderationActions).values({
        id: newUlid(),
        actorId: "desk",
        action: "remove",
        subjectType,
        subjectId,
        subjectOwnerId: runner,
        reason: "it's spam",
        createdAt: NOW,
      });
    }
    await core().delete(entryPhotos).where(eq(entryPhotos.id, gonePhoto));
    await core().delete(outfitEntries).where(eq(outfitEntries.id, goneKit));

    const found = await otherPhotosOf(core(), [
      { subjectType: "photo", subjectId: gonePhoto },
      { subjectType: "entry", subjectId: goneKit },
    ]);

    expect(ids(found.get(`photo:${gonePhoto}`))).toStrictEqual([other]);
    expect(ids(found.get(`entry:${goneKit}`))).toStrictEqual([other]);
  });

  it("reads the live owner first, not an audit row about the subject", async () => {
    const runner = await makeUser();
    const reported = await photo(await kit(runner, NOW));
    const other = await photo(await kit(runner, NOW - 1));
    const stranger = await makeUser();
    await photo(await kit(stranger, NOW));
    // An audit row naming someone else: the live row wins.
    await core().insert(moderationActions).values({
      id: newUlid(),
      actorId: "desk",
      action: "remove",
      subjectType: "photo",
      subjectId: reported,
      subjectOwnerId: stranger,
      reason: "it's spam",
      createdAt: NOW,
    });

    const found = await otherPhotosOf(core(), [
      { subjectType: "photo", subjectId: reported },
    ]);

    expect(ids(found.get(`photo:${reported}`))).toStrictEqual([other]);
  });

  it("reads nothing for no subjects", async () => {
    expect(await otherPhotosOf(core(), [])).toStrictEqual(new Map());
  });
});

describe("the read's cost", () => {
  it("probes the runner's kits and each kit's photos by index, never a scan", async () => {
    for (const subjectType of ["photo", "entry"] as const) {
      const { sql, params } = otherPhotosQuery(core(), {
        subjectType,
        subjectId: newUlid(),
      }).toSQL();
      const plan = await env.DIALED_CORE.prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .bind(...params)
        .all<{ detail: string }>();
      const details = plan.results.map((row) => row.detail).join("\n");
      expect(details).toMatch(
        /outfit_entries USING INDEX entries_user_created/,
      );
      expect(details).toMatch(
        /entry_photos USING INDEX entry_photos_idempotency/,
      );
      expect(details).toMatch(
        /moderation_actions USING INDEX moderation_actions_subject/,
      );
      expect(details).not.toMatch(
        /SCAN\s+(outfit_entries|entry_photos|moderation_actions)/i,
      );
    }
  });
});

describe("Review's rows", () => {
  it("lists them on a row an intimate report started, and on no other", async () => {
    const runner = await makeUser();
    const reportedKit = await kit(runner, NOW);
    const reportedPhoto = await photo(await kit(runner, NOW - 1));
    const other = await photo(await kit(runner, NOW - 2));
    const spammy = await kit(await makeUser(), NOW);
    const person = await makeUser();
    // Each row as a report and its queue row, written directly: the rows'
    // reads are what is under test, not how a report gets them there. A
    // profile cannot carry an intimate report from W1; a row that somehow
    // has one still lists nothing, since no photo is its subject.
    const subjects = [
      ["entry", reportedKit, "intimate"],
      ["photo", reportedPhoto, "intimate"],
      ["entry", spammy, "spam"],
      ["profile", person, "intimate"],
    ] as const;
    for (const [subjectType, subjectId, reason] of subjects) {
      await core()
        .insert(reports)
        .values({
          id: newUlid(),
          reporterId: await makeUser(),
          subjectType,
          subjectId,
          reason,
          createdAt: nowSeconds(),
        });
      await core().insert(reviewQueue).values({
        id: newUlid(),
        subjectType,
        subjectId,
        source: "reports",
        status: "pending",
        createdAt: nowSeconds(),
      });
    }

    const queue = await pendingReviewQueue();

    const rowFor = (id: string) => queue.find((row) => row.subjectId === id);
    expect(queue).toHaveLength(4);
    expect(ids(rowFor(reportedKit)?.otherPhotos)).toStrictEqual([
      reportedPhoto,
      other,
    ]);
    expect(ids(rowFor(reportedPhoto)?.otherPhotos)).toStrictEqual([other]);
    expect(rowFor(spammy)?.otherPhotos).toBeUndefined();
    expect(rowFor(person)?.otherPhotos).toBeUndefined();
  });

  it("lists them on a removal request whose link is ours, and none on one that is not", async () => {
    const runner = await makeUser();
    const reported = await kit(runner, NOW);
    const other = await photo(await kit(runner, NOW - 1));
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
      core(),
      {
        ...filing,
        location: `https://dialed.run/feed/entry/${reported}`,
        idempotencyKey: newUlid(),
      },
      deps,
      NOW,
    );
    await fileTakedownRequest(
      core(),
      { ...filing, location: "a forum somewhere", idempotencyKey: newUlid() },
      deps,
      NOW + 1,
    );

    const [ours, theirs] = await pendingTakedownRequests(core(), NOW);

    expect(ids(ours?.otherPhotos)).toStrictEqual([other]);
    expect(theirs?.location).toBe("a forum somewhere");
    expect(theirs?.otherPhotos).toBeUndefined();
  });
});
