import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  entryPhotos,
  entryTags,
  imports,
  notifications,
  outbox,
  outfitEntries,
  outfitEntryItems,
  reactions,
  reviewQueue,
  runs,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import {
  entryPhotoKeyFor,
  entryPhotoPrefix,
} from "../../src/lib/entry-photo-key";
import { newUlid } from "../../src/lib/ids";
import { NotFoundError } from "../../src/lib/errors";
import {
  deleteEntryPhoto,
  deleteRun,
  deleteRuns,
  retractEntries,
  retractEntry,
} from "../../src/modules/feed";
// A deep import on purpose: `photoIdInput` is a trust-boundary schema, not
// part of the feed barrel's public surface (its only other consumer is
// `functions.ts`, which no test can import at all).
import { photoIdInput } from "../../src/modules/feed/retract";
import { drainOutbox } from "../../src/modules/ops/outbox";
import { fileReport, reconcileUnhiddenReports } from "../../src/modules/safety";

import {
  makeEntry,
  makeItem,
  makeRun,
  makeUser,
  NOW,
  resetSafetyTables,
} from "./helpers";

/**
 * SAF-3: a runner deleting what they posted. Every assertion is about what
 * is left afterwards — rows in D1 and objects in R2 — because a delete
 * that answered "done" and left either behind is the defect (audit 0.9).
 */

function core() {
  return drizzle(env.DIALED_CORE);
}

function quiet(): void {
  // Sentry reports are expected on the failure paths below.
}

async function stored(prefix: string): Promise<string[]> {
  const listed = await env.MEDIA.list({ prefix });
  return listed.objects.map((object) => object.key);
}

/**
A photo row and its object, as an upload leaves them.
*/
async function photoOn(
  userId: string,
  entryId: string,
  position = 0,
): Promise<{ id: string; key: string }> {
  const id = newUlid();
  const key = entryPhotoKeyFor(userId, entryId, id);
  await env.MEDIA.put(key, new Uint8Array([1, 2, 3]));
  await core()
    .insert(entryPhotos)
    .values({ id, entryId, photoKey: key, position, screenStatus: "pass" });
  return { id, key };
}

/**
An entry with everything a real one accumulates: kit, tag, photos, a
Useful, the verdict prompt's notification.
*/
async function fullEntry(userId: string) {
  const runId = await makeRun({ userId });
  const itemId = await makeItem({ userId });
  const entryId = await makeEntry({ userId, runId, itemIds: [itemId] });
  await core().insert(entryTags).values({ entryId, tag: "windy" });
  await core()
    .insert(reactions)
    .values({ entryId, userId: await makeUser(), createdAt: NOW });
  await core().insert(notifications).values({
    id: newUlid(),
    userId,
    kind: "verdict_prompt",
    subjectId: entryId,
    body: "You didn't log a verdict for this run.",
    createdAt: NOW,
  });
  await core().insert(notifications).values({
    id: newUlid(),
    userId,
    kind: "kit_reminder",
    subjectId: runId,
    body: "What did you wear?",
    createdAt: NOW,
  });
  const photos = [
    await photoOn(userId, entryId, 0),
    await photoOn(userId, entryId, 1),
  ];
  return { runId, itemId, entryId, photos };
}

async function rowsFor(entryId: string) {
  return {
    entry: await core()
      .select({ id: outfitEntries.id })
      .from(outfitEntries)
      .where(eq(outfitEntries.id, entryId)),
    items: await core()
      .select()
      .from(outfitEntryItems)
      .where(eq(outfitEntryItems.entryId, entryId)),
    tags: await core()
      .select()
      .from(entryTags)
      .where(eq(entryTags.entryId, entryId)),
    photos: await core()
      .select()
      .from(entryPhotos)
      .where(eq(entryPhotos.entryId, entryId)),
    reactions: await core()
      .select()
      .from(reactions)
      .where(eq(reactions.entryId, entryId)),
    prompts: await core()
      .select()
      .from(notifications)
      .where(eq(notifications.subjectId, entryId)),
  };
}

const NOTHING = {
  entry: [],
  items: [],
  tags: [],
  photos: [],
  reactions: [],
  prompts: [],
};

beforeEach(async () => {
  await resetSafetyTables();
  await core().delete(outbox);
  await core().delete(imports);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("photoIdInput", () => {
  it("requires the one field it names, shaped as a ulid", () => {
    const photoId = newUlid();
    expect(photoIdInput.parse({ photoId })).toStrictEqual({ photoId });
    expect(() => photoIdInput.parse({})).toThrow();
    expect(() => photoIdInput.parse({ photoId: "not-a-ulid" })).toThrow();
  });
});

describe("deleting an entry", () => {
  it("leaves no row and no object, and nothing owed", async () => {
    const userId = await makeUser();
    const { entryId, runId } = await fullEntry(userId);

    await retractEntry(core(), userId, entryId);

    expect(await rowsFor(entryId)).toStrictEqual(NOTHING);
    expect(await stored(entryPhotoPrefix(userId, entryId))).toStrictEqual([]);
    expect(await core().select().from(outbox)).toStrictEqual([]);
    // The run stays: it is the entry that was taken back, not the run.
    const [run] = await core().select().from(runs).where(eq(runs.id, runId));
    expect(run?.id).toBe(runId);
  });

  it("refuses another runner's entry as not found, and touches nothing of theirs", async () => {
    const owner = await makeUser();
    const { entryId, photos } = await fullEntry(owner);
    const stranger = await makeUser();

    await expect(retractEntry(core(), stranger, entryId)).rejects.toThrow(
      NotFoundError,
    );
    // The message itself, not just the type — `retractOneOf`'s message is
    // fixed per entry point, and a blank one would still be a NotFoundError.
    await expect(retractEntry(core(), stranger, entryId)).rejects.toThrow(
      "entry not found",
    );
    const left = await rowsFor(entryId);
    expect(left.entry).toHaveLength(1);
    expect(left.photos).toHaveLength(2);
    expect(await stored(entryPhotoPrefix(owner, entryId))).toStrictEqual(
      photos.map((photo) => photo.key).toSorted((a, b) => a.localeCompare(b)),
    );
  });

  it("owes the bytes when R2 fails, and the drain deletes them", async () => {
    const userId = await makeUser();
    const { entryId } = await fullEntry(userId);
    const report = vi.fn(quiet);
    vi.spyOn(env.MEDIA, "delete").mockRejectedValueOnce(new Error("R2 down"));

    await retractEntry(core(), userId, entryId, report);

    // The runner's delete happened: the rows are gone at once.
    expect(await rowsFor(entryId)).toStrictEqual(NOTHING);
    expect(report).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ kind: "entry_media_delete", entryId, userId }),
    );
    expect(await stored(entryPhotoPrefix(userId, entryId))).toHaveLength(2);
    expect(await core().select().from(outbox)).toHaveLength(1);

    await drainOutbox(core(), [], { now: NOW * 10 });

    expect(await stored(entryPhotoPrefix(userId, entryId))).toStrictEqual([]);
    expect(await core().select().from(outbox)).toStrictEqual([]);
  });

  it("settles the open review as removed by the author, so the sweep does not queue it again", async () => {
    const userId = await makeUser();
    const { entryId } = await fullEntry(userId);
    for (let n = 0; n < 3; n += 1) {
      await fileReport({
        reporterId: await makeUser(),
        subjectType: "entry",
        subjectId: entryId,
        reason: "spam",
      });
    }

    await retractEntry(core(), userId, entryId);

    const [queued] = await core()
      .select()
      .from(reviewQueue)
      .where(eq(reviewQueue.subjectId, entryId));
    expect(queued).toMatchObject({ status: "removed", resolvedBy: userId });
    expect(await reconcileUnhiddenReports()).toStrictEqual({
      found: 0,
      hidden: 0,
    });
  });

  it("deletes every entry of a runner's with 'all', and nobody else's", async () => {
    const userId = await makeUser();
    const first = await fullEntry(userId);
    const second = await fullEntry(userId);
    const other = await makeUser();
    const theirs = await fullEntry(other);

    await retractEntries(core(), userId, "all");

    expect(await rowsFor(first.entryId)).toStrictEqual(NOTHING);
    expect(await rowsFor(second.entryId)).toStrictEqual(NOTHING);
    expect(await stored(entryPhotoPrefix(userId))).toStrictEqual([]);
    const theirsLeft = await rowsFor(theirs.entryId);
    expect(theirsLeft.entry).toHaveLength(1);
    expect(await stored(entryPhotoPrefix(other))).toHaveLength(2);
  });

  it("deletes only the entries named, not the rest of the same runner's", async () => {
    // A specific-ids scope must not be read as "all of this runner's" —
    // `owned`'s `scope === "all"` decides which, and getting it backwards
    // would delete a sibling entry nobody named.
    const userId = await makeUser();
    const first = await fullEntry(userId);
    const second = await fullEntry(userId);

    await retractEntries(core(), userId, [first.entryId]);

    expect(await rowsFor(first.entryId)).toStrictEqual(NOTHING);
    const secondLeft = await rowsFor(second.entryId);
    expect(secondLeft.entry).toHaveLength(1);
    expect(secondLeft.photos).toHaveLength(2);
  });

  it("settles a review of an entry's own photo when the whole entry goes, not just the entry's own review", async () => {
    const userId = await makeUser();
    const { entryId, photos } = await fullEntry(userId);
    const [photo] = photos;
    if (photo === undefined) throw new Error("fixture");
    for (let n = 0; n < 3; n += 1) {
      await fileReport({
        reporterId: await makeUser(),
        subjectType: "photo",
        subjectId: photo.id,
        reason: "spam",
      });
    }

    await retractEntry(core(), userId, entryId);

    const [queued] = await core()
      .select()
      .from(reviewQueue)
      .where(eq(reviewQueue.subjectId, photo.id));
    expect(queued).toMatchObject({ status: "removed", resolvedBy: userId });
  });

  it("settles a review still marked 'reviewing' — a claimed but abandoned tab — when the entry goes", async () => {
    const userId = await makeUser();
    const { entryId } = await fullEntry(userId);
    await core().insert(reviewQueue).values({
      id: newUlid(),
      subjectType: "entry",
      subjectId: entryId,
      source: "classifier",
      status: "reviewing",
      createdAt: NOW,
    });

    await retractEntry(core(), userId, entryId);

    const [queued] = await core()
      .select()
      .from(reviewQueue)
      .where(eq(reviewQueue.subjectId, entryId));
    expect(queued).toMatchObject({ status: "removed", resolvedBy: userId });
  });
});

describe("deleting one photo", () => {
  it("takes that photo's row and object and keeps the rest", async () => {
    const userId = await makeUser();
    const { entryId, photos } = await fullEntry(userId);
    const [gone, kept] = photos;
    if (gone === undefined || kept === undefined) throw new Error("fixture");

    await deleteEntryPhoto(core(), userId, gone.id);

    const left = await rowsFor(entryId);
    expect(left.photos.map((photo) => photo.id)).toStrictEqual([kept.id]);
    expect(left.entry).toHaveLength(1);
    expect(await stored(entryPhotoPrefix(userId, entryId))).toStrictEqual([
      kept.key,
    ]);
  });

  it("refuses another runner's photo as not found", async () => {
    const owner = await makeUser();
    const { photos } = await fullEntry(owner);
    const [photo] = photos;
    if (photo === undefined) throw new Error("fixture");

    await expect(
      deleteEntryPhoto(core(), await makeUser(), photo.id),
    ).rejects.toThrow("photo not found");
    expect(await stored(photo.key)).toStrictEqual([photo.key]);
  });

  it("settles an open review of the photo", async () => {
    const userId = await makeUser();
    const { photos } = await fullEntry(userId);
    const [photo] = photos;
    if (photo === undefined) throw new Error("fixture");
    await core().insert(reviewQueue).values({
      id: newUlid(),
      subjectType: "photo",
      subjectId: photo.id,
      source: "classifier",
      createdAt: NOW,
    });

    await deleteEntryPhoto(core(), userId, photo.id);

    const [queued] = await core()
      .select()
      .from(reviewQueue)
      .where(eq(reviewQueue.subjectId, photo.id));
    expect(queued).toMatchObject({ status: "removed", resolvedBy: userId });
  });
});

/**
A run imported from a file, with the file still in IMPORTS.
*/
async function importedRun(userId: string) {
  const made = await fullEntry(userId);
  const key = `imports/${userId}/${newUlid()}.gpx`;
  await env.IMPORTS.put(key, new Uint8Array([1]));
  await core().insert(imports).values({
    id: newUlid(),
    userId,
    r2Key: key,
    status: "done",
    runId: made.runId,
    createdAt: NOW,
  });
  return { ...made, key };
}

describe("deleting a run", () => {
  it("takes its entry, its photos, its upload and its reminders with it", async () => {
    const userId = await makeUser();
    const { runId, entryId, key } = await importedRun(userId);

    await deleteRun(core(), userId, runId);

    expect(
      await core().select().from(runs).where(eq(runs.id, runId)),
    ).toStrictEqual([]);
    expect(await rowsFor(entryId)).toStrictEqual(NOTHING);
    expect(
      await core()
        .select()
        .from(notifications)
        .where(eq(notifications.subjectId, runId)),
    ).toStrictEqual([]);
    expect(
      await core().select().from(imports).where(eq(imports.runId, runId)),
    ).toStrictEqual([]);
    expect(await env.IMPORTS.head(key)).toBeNull();
    expect(await stored(entryPhotoPrefix(userId, entryId))).toStrictEqual([]);
    expect(await core().select().from(outbox)).toStrictEqual([]);
  });

  it("deletes a run with no entry", async () => {
    const userId = await makeUser();
    const runId = await makeRun({ userId });
    await deleteRun(core(), userId, runId);
    expect(
      await core().select().from(runs).where(eq(runs.id, runId)),
    ).toStrictEqual([]);
  });

  it("refuses another runner's run as not found", async () => {
    const owner = await makeUser();
    const { runId, key } = await importedRun(owner);

    await expect(deleteRun(core(), await makeUser(), runId)).rejects.toThrow(
      "run not found",
    );
    expect(
      await core().select().from(runs).where(eq(runs.id, runId)),
    ).toHaveLength(1);
    expect(await env.IMPORTS.head(key)).not.toBeNull();
  });

  it("deletes every run of a runner's with 'all', and nobody else's", async () => {
    const userId = await makeUser();
    const first = await importedRun(userId);
    const second = await importedRun(userId);
    const other = await makeUser();
    const theirs = await importedRun(other);

    await deleteRuns(core(), userId, "all");

    expect(
      await core().select().from(runs).where(eq(runs.userId, userId)),
    ).toStrictEqual([]);
    expect(await rowsFor(first.entryId)).toStrictEqual(NOTHING);
    expect(await rowsFor(second.entryId)).toStrictEqual(NOTHING);
    expect(await env.IMPORTS.head(first.key)).toBeNull();
    expect(await env.IMPORTS.head(second.key)).toBeNull();
    expect(await stored(entryPhotoPrefix(userId))).toStrictEqual([]);
    expect(
      await core().select().from(runs).where(eq(runs.userId, other)),
    ).toHaveLength(1);
    expect(await env.IMPORTS.head(theirs.key)).not.toBeNull();
  });

  it("treats 'all' as every entry of the runner's, even one whose own run-id names no row of theirs", async () => {
    // `deleteRuns`'s `entryScope` takes a shortcut for scope "all": read
    // straight off `userId` rather than re-derive through a run-id join —
    // deliberately, so it stays correct (and cheap, CLAUDE.md's D1 param
    // cap) for a row whose run reference the join could not retrace. A
    // migration artefact or a partial write could leave one; this plants
    // it directly.
    const userId = await makeUser();
    await makeRun({ userId });
    const orphanEntryId = await makeEntry({ userId, runId: newUlid() });

    await deleteRuns(core(), userId, "all");

    expect(await rowsFor(orphanEntryId)).toStrictEqual(NOTHING);
  });

  it("deletes only the named run's entry, not a sibling run's entry of the same runner's", async () => {
    // The mirror of the "all" case above: with a SPECIFIC run named,
    // `entryScope` must resolve through the run-id join rather than take
    // the "all" shortcut, or naming one run would delete every entry this
    // runner has, on any other run too.
    const userId = await makeUser();
    const named = await fullEntry(userId);
    const sibling = await fullEntry(userId);

    await deleteRuns(core(), userId, [named.runId]);

    expect(await rowsFor(named.entryId)).toStrictEqual(NOTHING);
    expect(
      await core().select().from(runs).where(eq(runs.id, named.runId)),
    ).toStrictEqual([]);
    const survivor = await rowsFor(sibling.entryId);
    expect(survivor.entry).toHaveLength(1);
    expect(survivor.photos).toHaveLength(2);
    expect(
      await core().select().from(runs).where(eq(runs.id, sibling.runId)),
    ).toHaveLength(1);
  });
});
