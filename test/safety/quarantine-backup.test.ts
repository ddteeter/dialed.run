import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  entryPhotos,
  moderationActions,
  photoScreenings,
  quarantinedContent,
  reviewQueue,
  wardrobeItems,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import {
  entryPhotoKeyFor,
  entryPhotoPrefix,
  quarantineKeyFor,
} from "../../src/lib/entry-photo-key";
import { garmentPhotoPrefix } from "../../src/lib/garment-photo-key";
import { newUlid, ulidSchema } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import type { Report } from "../../src/modules/feed/entries";
import { deleteEntryPhoto } from "../../src/modules/feed/entries/retract";
import { moderateGarmentPhoto } from "../../src/modules/feed/moderation/garment-moderation";
import { moderateContent } from "../../src/modules/feed/moderation/moderation";
import {
  backUpMedia,
  GONE_PREFIX,
} from "../../src/modules/ops/daily/media-backup";
import {
  enqueueForReview,
  openSubject,
} from "../../src/modules/safety/review";
import {
  quarantinedScopes,
  quarantineInsert,
} from "../../src/modules/safety/takedowns";

import { beforeNextWriteBatch } from "../before-write-batch";
import { addAccount } from "../feed/helpers";
import { noPurge } from "../purge-spy";
import {
  batchWithAfter,
  makeEntry,
  makeItem,
  makeRun,
  makeUser,
  resetSafetyTables,
  shownRowOf,
} from "./helpers";

/**
 * A quarantine and the daily photo backup (D-70, D-172): once a
 * quarantine's record lands, the backup holds no copy of what it took,
 * under the photo's key or under `gone/`, and the daily backup makes none
 * while the record lasts.
 */

function core() {
  return drizzle(env.DIALED_CORE);
}

function quiet(): void {
  // No report is expected on these paths.
}

const BYTES = new Uint8Array([1, 2, 3]);
const SIZES = ["card.webp", "original.jpg"];

/**
A photo in MEDIA, with the copy a daily backup made of it.
*/
async function backedUp(key: string): Promise<void> {
  await env.MEDIA.put(key, BYTES);
  await env.MEDIA_BACKUP.put(key, BYTES);
}

/**
A backup copy a daily backup set aside, as it does once its source is gone.
*/
async function setAside(key: string): Promise<void> {
  await env.MEDIA_BACKUP.put(`${GONE_PREFIX}${key}`, BYTES);
}

/**
What the backup holds of these keys, under each key and under gone/.
*/
async function heldInBackup(keys: readonly string[]): Promise<string[]> {
  const held: string[] = [];
  for (const key of keys) {
    for (const at of [key, `${GONE_PREFIX}${key}`]) {
      if ((await env.MEDIA_BACKUP.head(at)) !== null) held.push(at);
    }
  }
  return held;
}

async function kitOf(author: string): Promise<string> {
  const runId = await makeRun({ userId: author });
  return makeEntry({ userId: author, runId, audience: "runners" });
}

/**
A photo on the kit, stored and backed up.
*/
async function photoOn(author: string, entryId: string) {
  const photoId = newUlid();
  const key = entryPhotoKeyFor(author, entryId, photoId);
  await backedUp(key);
  await core()
    .insert(entryPhotos)
    .values({ id: photoId, entryId, photoKey: key, position: 0 });
  return { photoId, key };
}

/**
A garment with a photo, every size stored and backed up.
*/
async function garmentPhoto(owner: string) {
  const itemId = await makeItem({ userId: owner });
  const photoKey = `${garmentPhotoPrefix(owner)}${itemId}/${newUlid()}`;
  const keys = SIZES.map((name) => `${photoKey}/${name}`);
  for (const key of keys) await backedUp(key);
  await core()
    .update(wardrobeItems)
    .set({ photoKey, visibility: "pending" })
    .where(eq(wardrobeItems.id, itemId));
  return { itemId, photoKey, keys };
}

async function quarantine(
  subjectType: "entry" | "photo",
  subjectId: string,
  report: Report = quiet,
) {
  return moderateContent(
    core(),
    {
      actorId: "rev",
      action: "quarantine",
      subjectType,
      subjectId,
      reason: "explicit",
    },
    report,
    noPurge,
  );
}

async function quarantineGarment(itemId: string) {
  return moderateGarmentPhoto(
    core(),
    { actorId: "rev", itemId, action: "quarantine", reason: "explicit" },
    quiet,
  );
}

/**
One daily backup of the runner's photos, with the records as they stand.
*/
async function dailyBackup(owner: string): Promise<string[]> {
  const anomalies: string[] = [];
  await backUpMedia(
    {
      source: env.MEDIA,
      backup: env.MEDIA_BACKUP,
      quarantined: quarantinedScopes,
    },
    anomalies,
    {
      now: nowSeconds(),
      prefixes: [entryPhotoPrefix(owner), garmentPhotoPrefix(owner)],
    },
  );
  return anomalies;
}

async function recordCount(): Promise<number> {
  return core().$count(quarantinedContent);
}

describe("a quarantine deletes the backup's copies of what it took", () => {
  beforeEach(resetSafetyTables);
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("of a kit photo, under its key and under gone/, and keeps the kit's other photo's", async () => {
    const author = await makeUser();
    const entryId = await kitOf(author);
    const taken = await photoOn(author, entryId);
    const other = await photoOn(author, entryId);
    await setAside(taken.key);

    expect(await quarantine("photo", taken.photoId)).toBe("removed");

    expect(await heldInBackup([taken.key, other.key])).toStrictEqual([
      other.key,
    ]);
  });

  it("of every photo on a kit quarantined whole, and of no other kit", async () => {
    const author = await makeUser();
    const entryId = await kitOf(author);
    const first = await photoOn(author, entryId);
    const second = await photoOn(author, entryId);
    await setAside(second.key);
    const elsewhere = await photoOn(author, await kitOf(author));

    expect(await quarantine("entry", entryId)).toBe("removed");

    expect(
      await heldInBackup([first.key, second.key, elsewhere.key]),
    ).toStrictEqual([elsewhere.key]);
  });

  it("of every size of a garment photo, and keeps an older version's", async () => {
    const owner = await makeUser();
    const { itemId, keys } = await garmentPhoto(owner);
    for (const key of keys) await setAside(key);
    const older = `${garmentPhotoPrefix(owner)}${itemId}/${newUlid()}/card.webp`;
    await setAside(older);

    expect(await quarantineGarment(itemId)).toBe("removed");

    expect(await heldInBackup([...keys, older])).toStrictEqual([
      `${GONE_PREFIX}${older}`,
    ]);
  });

  it("when its owner's delete got there first, the copy already set aside too", async () => {
    const author = await makeUser();
    const { photoId, key } = await photoOn(author, await kitOf(author));
    await setAside(key);
    await core().batch([
      enqueueForReview(core(), {
        subjectType: "photo",
        subjectId: photoId,
        source: "classifier",
      }),
    ]);
    const [row] = await core()
      .select({ id: reviewQueue.id })
      .from(reviewQueue)
      .where(eq(reviewQueue.subjectId, photoId));
    const queueId = ulidSchema.parse(row?.id);
    const subject = await openSubject(queueId, await shownRowOf(queueId));
    if (subject === undefined) throw new Error("not open");

    const outcome = await moderateContent(
      batchWithAfter(subject.heldTo.statement, () =>
        deleteEntryPhoto(core(), author, photoId, quiet, noPurge),
      ),
      {
        actorId: "rev",
        action: "quarantine",
        subjectType: "photo",
        subjectId: photoId,
        reason: "explicit",
        heldTo: subject.heldTo,
      },
      quiet,
      noPurge,
    );

    expect(outcome).toBe("removed");
    expect(await recordCount()).toBe(1);
    expect(await heldInBackup([key])).toStrictEqual([]);
  });

  it("of the version decided on when the owner replaced the photo since, and keeps the new one's", async () => {
    const owner = await makeUser();
    const { itemId, keys } = await garmentPhoto(owner);
    const newKey = `${garmentPhotoPrefix(owner)}${itemId}/${newUlid()}`;
    const newCopy = `${newKey}/card.webp`;
    await backedUp(newCopy);
    beforeNextWriteBatch(async () => {
      await core()
        .update(wardrobeItems)
        .set({ photoKey: newKey, photoFingerprint: sql`NULL` })
        .where(eq(wardrobeItems.id, itemId));
      await core()
        .delete(photoScreenings)
        .where(eq(photoScreenings.photoId, itemId));
    });

    expect(await quarantineGarment(itemId)).toBe("removed");

    expect(await recordCount()).toBe(1);
    expect(await heldInBackup([...keys, newCopy])).toStrictEqual([newCopy]);
  });

  it("still quarantines when the backup's delete fails, reports it, and the next daily backup deletes the copy", async () => {
    const author = await makeUser();
    const { photoId, key } = await photoOn(author, await kitOf(author));
    const failure = new Error("R2 is down");
    vi.spyOn(env.MEDIA_BACKUP, "delete").mockRejectedValueOnce(failure);
    const report = vi.fn<Report>();

    expect(await quarantine("photo", photoId, report)).toBe("removed");

    expect(await recordCount()).toBe(1);
    expect(report.mock.calls).toStrictEqual([
      [
        failure,
        {
          surface: "quarantine-backup",
          subjectType: "photo",
          subjectId: photoId,
        },
      ],
    ]);
    expect(await heldInBackup([key])).toStrictEqual([key]);

    expect(await dailyBackup(author)).toStrictEqual([]);
    expect(await heldInBackup([key])).toStrictEqual([]);
  });

  it("deletes nothing of a photo whose quarantine was refused", async () => {
    const author = await makeUser();
    const { photoId, key } = await photoOn(author, await kitOf(author));
    const failing = core();
    Reflect.set(failing, "batch", () =>
      Promise.reject(new Error("D1 is down")),
    );

    await expect(
      moderateContent(
        failing,
        {
          actorId: "rev",
          action: "quarantine",
          subjectType: "photo",
          subjectId: photoId,
          reason: "explicit",
        },
        quiet,
        noPurge,
      ),
    ).rejects.toThrow("D1 is down");

    expect(await heldInBackup([key])).toStrictEqual([key]);
  });

  it("leaves the backup alone on a Remove, of a kit photo or a garment photo", async () => {
    const author = await makeUser();
    await addAccount(author, true);
    const { photoId, key } = await photoOn(author, await kitOf(author));
    const { itemId, keys } = await garmentPhoto(author);

    await moderateContent(
      core(),
      {
        actorId: "rev",
        action: "remove",
        subjectType: "photo",
        subjectId: photoId,
        reason: "home",
      },
      quiet,
      noPurge,
    );
    await moderateGarmentPhoto(
      core(),
      { actorId: "rev", itemId, action: "remove", reason: "home" },
      quiet,
    );

    expect(await heldInBackup([key, ...keys])).toStrictEqual([key, ...keys]);
  });
});

describe("the daily backup and a quarantined photo", () => {
  beforeEach(resetSafetyTables);
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("never copies a photo quarantined before the backup reached it", async () => {
    const author = await makeUser();
    const entryId = await kitOf(author);
    const photoId = newUlid();
    const key = entryPhotoKeyFor(author, entryId, photoId);
    await env.MEDIA.put(key, BYTES);
    await core()
      .insert(entryPhotos)
      .values({ id: photoId, entryId, photoKey: key, position: 0 });

    await quarantine("photo", photoId);
    expect(await dailyBackup(author)).toStrictEqual([]);

    expect(await heldInBackup([key])).toStrictEqual([]);
  });

  it("copies none while the quarantine's delete of the original is still owed", async () => {
    const author = await makeUser();
    const { itemId, keys } = await garmentPhoto(author);
    await env.MEDIA_BACKUP.delete([...keys]);
    vi.spyOn(env.MEDIA, "delete").mockRejectedValue(new Error("R2 is down"));

    await quarantineGarment(itemId);
    vi.restoreAllMocks();
    // The original is still there, owed its delete.
    for (const key of keys) expect(await env.MEDIA.head(key)).not.toBeNull();
    expect(await dailyBackup(author)).toStrictEqual([]);

    expect(await heldInBackup(keys)).toStrictEqual([]);
  });
});

/**
The record's photos, as its snapshot lists them: which key, kept where, and from which backup copy.
*/
const keptPhotosSchema = z.array(
  z.object({
    preservedKey: z.string(),
    fromBackup: z.string().optional(),
  }),
);

async function keptPhotos() {
  const [record] = await core()
    .select({ snapshot: quarantinedContent.photosSnapshot })
    .from(quarantinedContent);
  const decoded: unknown = JSON.parse(record?.snapshot ?? "");
  return keptPhotosSchema
    .parse(decoded)
    .map(({ preservedKey, fromBackup }) => ({ preservedKey, fromBackup }));
}

async function textAt(key: string): Promise<string | undefined> {
  const object = await env.MEDIA.get(key);
  return object?.text();
}

describe("a quarantine keeps the backup's copy of what MEDIA no longer has", () => {
  beforeEach(resetSafetyTables);

  it("a kit photo whose file is missing, from the copy under its key, then deletes that copy", async () => {
    const author = await makeUser();
    const { photoId, key } = await photoOn(author, await kitOf(author));
    await env.MEDIA.delete(key);
    await env.MEDIA_BACKUP.put(key, "the backup's bytes");

    expect(await quarantine("photo", photoId)).toBe("removed");

    expect(await textAt(quarantineKeyFor(key))).toBe("the backup's bytes");
    expect(await keptPhotos()).toStrictEqual([
      { preservedKey: quarantineKeyFor(key), fromBackup: key },
    ]);
    expect(await heldInBackup([key])).toStrictEqual([]);
  });

  it("a kit photo the backup had set aside, from its gone/ copy", async () => {
    const author = await makeUser();
    const { photoId, key } = await photoOn(author, await kitOf(author));
    await env.MEDIA.delete(key);
    await env.MEDIA_BACKUP.delete(key);
    await env.MEDIA_BACKUP.put(`${GONE_PREFIX}${key}`, "set aside");

    expect(await quarantine("photo", photoId)).toBe("removed");

    expect(await textAt(quarantineKeyFor(key))).toBe("set aside");
    expect(await keptPhotos()).toStrictEqual([
      {
        preservedKey: quarantineKeyFor(key),
        fromBackup: `${GONE_PREFIX}${key}`,
      },
    ]);
    expect(await heldInBackup([key])).toStrictEqual([]);
  });

  it("every size of a garment photo, from MEDIA where it has them and from the backup where not", async () => {
    const owner = await makeUser();
    const { itemId, keys } = await garmentPhoto(owner);
    const [card, original] = keys;
    if (card === undefined || original === undefined) throw new Error("sizes");
    await env.MEDIA.put(card, "from MEDIA");
    await env.MEDIA.delete(original);
    await env.MEDIA_BACKUP.delete(original);
    await env.MEDIA_BACKUP.put(`${GONE_PREFIX}${original}`, "from the backup");

    expect(await quarantineGarment(itemId)).toBe("removed");

    expect(await textAt(quarantineKeyFor(card))).toBe("from MEDIA");
    expect(await textAt(quarantineKeyFor(original))).toBe("from the backup");
    expect(await keptPhotos()).toStrictEqual([
      { preservedKey: quarantineKeyFor(card), fromBackup: undefined },
      {
        preservedKey: quarantineKeyFor(original),
        fromBackup: `${GONE_PREFIX}${original}`,
      },
    ]);
    expect(await heldInBackup(keys)).toStrictEqual([]);
  });

  it("only what MEDIA has when the backup holds the same, and says no backup copy was used", async () => {
    const author = await makeUser();
    const { photoId, key } = await photoOn(author, await kitOf(author));
    await env.MEDIA_BACKUP.put(key, "an older copy");

    expect(await quarantine("photo", photoId)).toBe("removed");

    expect(await textAt(quarantineKeyFor(key))).toBe(
      new TextDecoder().decode(BYTES),
    );
    expect(await keptPhotos()).toStrictEqual([
      { preservedKey: quarantineKeyFor(key), fromBackup: undefined },
    ]);
  });
});

describe("quarantinedScopes", () => {
  beforeEach(resetSafetyTables);

  it("names a kit photo by its key, a kit by its prefix and a garment photo by its version", async () => {
    const author = await makeUser();
    const photoKit = await kitOf(author);
    const { photoId, key } = await photoOn(author, photoKit);
    const wholeKit = await kitOf(author);
    await photoOn(author, wholeKit);
    const { itemId, photoKey } = await garmentPhoto(author);

    await quarantine("photo", photoId);
    await quarantine("entry", wholeKit);
    await quarantineGarment(itemId);

    const scopes = await quarantinedScopes();
    expect(scopes.toSorted((a, b) => a.localeCompare(b))).toStrictEqual(
      [key, entryPhotoPrefix(author, wholeKit), photoKey].toSorted((a, b) =>
        a.localeCompare(b),
      ),
    );
  });

  it("names nothing outside its uploader's photos or the quarantine prefix", async () => {
    const uploader = `up${newUlid()}`;
    const own = `items/${uploader}/garment/version`;
    const keys = [
      `quarantine/${own}`,
      // Another runner's, whose id starts with the uploader's.
      `quarantine/entries/${uploader}x/kit/photo`,
      // The uploader's own, but not under the quarantine prefix.
      `entries/${uploader}/kit/photo`,
      `xxxxxxxxxxxentries/${uploader}/kit/photo`,
      // None at all, which the column leaves NULL.
      undefined,
    ];
    for (const preservedKey of keys) {
      const actionId = newUlid();
      await core().insert(moderationActions).values({
        id: actionId,
        actorId: "rev",
        action: "quarantine",
        subjectType: "photo",
        subjectId: newUlid(),
        reason: "explicit",
        preservedKey,
        createdAt: nowSeconds(),
      });
      await quarantineInsert(core(), {
        moderationActionId: actionId,
        subjectType: "photo",
        subjectId: newUlid(),
        uploaderId: uploader,
        entrySnapshot: "{}",
        photosSnapshot: "[]",
        quarantinedAt: nowSeconds(),
      });
    }

    expect(await quarantinedScopes()).toStrictEqual([own]);
  });

  it("names nothing for an audit row with no record", async () => {
    const author = await makeUser();
    const { photoId } = await photoOn(author, await kitOf(author));
    await quarantine("photo", photoId);
    await core().delete(quarantinedContent);

    expect(await quarantinedScopes()).toStrictEqual([]);
  });
});
