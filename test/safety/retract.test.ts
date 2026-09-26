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
});
