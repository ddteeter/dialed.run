import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  accountDeletions,
  entryPhotos,
  outfitEntries,
  publicPhotos,
  userProfiles,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { entryPhotoKeyFor } from "../../src/lib/entry-photo-key";
import { newUlid } from "../../src/lib/ids";
import {
  newPublicPhotoKey,
  PUBLIC_PHOTO_CACHE_CONTROL,
  PUBLIC_PHOTOS_ORIGIN,
  publicPhotoUrl,
} from "../../src/lib/public-photos";
import { captureException } from "../../src/modules/ops/sentry";
import {
  publicPhotosOrigin,
  publishedPhotoUrls,
  sweepPublicPhotos,
  syncPublicPhotos,
  syncPublicPhotosLater,
  workerPublicPhotos,
  type PublicPhotoDeps,
} from "../../src/modules/ops/public-photos";
import { sweepPublicPhotoCopies } from "../../src/modules/ops/scheduled";
import {
  makeEntry,
  makeRun,
  makeVerifiedUser,
  NOW,
  resetSafetyTables,
} from "../safety/helpers";

/**
 * The public photo bucket (D-151, design 160 step 8): a copy of each
 * screened photo on a PUBLIC kit, under an unguessable key, and none of
 * anything else. Run against the test pool's real D1 and R2.
 */
const core = () => drizzle(env.DIALED_CORE);

type Status = (typeof entryPhotos.$inferSelect)["screenStatus"];

const BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

/**
Keys handed out in order, so a test can name the key a copy got.
*/
function keys(...minted: string[]): () => string {
  const queue = [...minted];
  return () => queue.shift() ?? newPublicPhotoKey();
}

function deps(overrides: Partial<PublicPhotoDeps> = {}): PublicPhotoDeps {
  return {
    db: core(),
    media: env.MEDIA,
    bucket: env.PUBLIC_PHOTOS,
    isPublishing: true,
    newKey: newPublicPhotoKey,
    report: vi.fn(),
    ...overrides,
  };
}

interface Kit {
  readonly userId: string;
  readonly entryId: string;
}

async function kit(audience: "private" | "runners" | "world" = "world") {
  const userId = await makeVerifiedUser();
  const runId = await makeRun({ userId });
  const entryId = await makeEntry({ userId, runId, audience });
  return { userId, entryId };
}

async function photoOn(
  { userId, entryId }: Kit,
  screenStatus: Status = "pass",
  position = 0,
): Promise<string> {
  const photoId = newUlid();
  const photoKey = entryPhotoKeyFor(userId, entryId, photoId);
  await env.MEDIA.put(photoKey, BYTES, {
    httpMetadata: { contentType: "image/jpeg" },
  });
  await core()
    .insert(entryPhotos)
    .values({ id: photoId, entryId, photoKey, position, screenStatus });
  return photoId;
}

async function copies() {
  return core().select().from(publicPhotos);
}

async function copiedEntries(): Promise<string[]> {
  const rows = await copies();
  return rows.map((copy) => copy.entryId);
}

async function bucketKeys(): Promise<string[]> {
  const listed = await env.PUBLIC_PHOTOS.list();
  return listed.objects.map((object) => object.key);
}

function only(entryId: string) {
  return { entryIds: [entryId], runnerIds: [] };
}

async function emptyBucket(): Promise<void> {
  const listed = await bucketKeys();
  if (listed.length > 0) await env.PUBLIC_PHOTOS.delete(listed);
}

beforeEach(async () => {
  await resetSafetyTables();
  await emptyBucket();
});

describe("the key", () => {
  it("is 128 random bits as 32 hex characters, fresh every time", () => {
    const minted = Array.from({ length: 500 }, () => newPublicPhotoKey());

    for (const key of minted) expect(key).toMatch(/^[0-9a-f]{32}$/u);
    expect(new Set(minted).size).toBe(500);
    // Every hex digit turns up: the bytes are spread, not a counter.
    expect(new Set(minted.join(""))).toStrictEqual(new Set("0123456789abcdef"));
  });

  it("pads a small byte to two digits", () => {
    const spy = vi
      .spyOn(crypto, "getRandomValues")
      .mockImplementation((array) => array);
    try {
      expect(newPublicPhotoKey()).toBe("0".repeat(32));
    } finally {
      spy.mockRestore();
    }
  });

  it("names nothing of the photo, the kit or the runner, and is the copy's whole path", async () => {
    const owner = await kit();
    const photoId = await photoOn(owner);

    await syncPublicPhotos(deps(), only(owner.entryId));

    const [copy] = await copies();
    expect(copy?.key).toMatch(/^[0-9a-f]{32}$/u);
    for (const id of [photoId, owner.entryId, owner.userId]) {
      expect(copy?.key.toLowerCase()).not.toContain(id.toLowerCase());
    }
    expect(await bucketKeys()).toStrictEqual([copy?.key]);
    expect(publicPhotoUrl(PUBLIC_PHOTOS_ORIGIN, "abc")).toBe(
      "https://photos.dialed.run/abc",
    );
  });
});

describe("copying", () => {
  it("copies a screened photo on a PUBLIC kit, with a minute's Cache-Control", async () => {
    const owner = await kit();
    const photoId = await photoOn(owner);

    await syncPublicPhotos(deps({ newKey: keys("k1") }), only(owner.entryId));

    const object = await env.PUBLIC_PHOTOS.get("k1");
    expect(new Uint8Array((await object?.arrayBuffer()) ?? [])).toStrictEqual(
      BYTES,
    );
    expect(object?.httpMetadata).toStrictEqual({
      contentType: "image/jpeg",
      cacheControl: "public, max-age=60",
    });
    expect(PUBLIC_PHOTO_CACHE_CONTROL).toBe("public, max-age=60");
    const [copy] = await copies();
    expect(copy).toMatchObject({
      key: "k1",
      photoId,
      entryId: owner.entryId,
      userId: owner.userId,
    });
    expect(copy?.publishedAt).toBeGreaterThan(NOW);
    expect(copy?.createdAt).toBeGreaterThan(NOW);
  });

  it.each(["pending", "flagged", "hidden_pending_review", "removed"] as const)(
    "never copies a photo that is %s",
    async (status) => {
      const owner = await kit();
      await photoOn(owner, status);

      await syncPublicPhotos(deps(), only(owner.entryId));

      expect(await copies()).toStrictEqual([]);
      expect(await bucketKeys()).toStrictEqual([]);
    },
  );

  it.each(["private", "runners"] as const)(
    "never copies a photo on a %s kit",
    async (audience) => {
      const owner = await kit(audience);
      await photoOn(owner);

      await syncPublicPhotos(deps(), only(owner.entryId));

      expect(await bucketKeys()).toStrictEqual([]);
    },
  );

  it.each(["hidden_pending_review", "removed"] as const)(
    "never copies a photo on a kit that is %s",
    async (moderationStatus) => {
      const owner = await kit();
      await photoOn(owner);
      await core()
        .update(outfitEntries)
        .set({ moderationStatus })
        .where(eq(outfitEntries.id, owner.entryId));

      await syncPublicPhotos(deps(), only(owner.entryId));

      expect(await bucketKeys()).toStrictEqual([]);
    },
  );

  it("never copies a banned or leaving runner's photo", async () => {
    const banned = await kit();
    const leaving = await kit();
    await photoOn(banned);
    await photoOn(leaving);
    await core()
      .update(userProfiles)
      .set({ bannedAt: NOW })
      .where(eq(userProfiles.userId, banned.userId));
    await core()
      .insert(accountDeletions)
      .values({ userId: leaving.userId, requestedAt: NOW, purgeAfter: NOW });

    await syncPublicPhotos(deps(), {
      entryIds: [],
      runnerIds: [banned.userId, leaving.userId],
    });

    expect(await bucketKeys()).toStrictEqual([]);
  });

  it("copies nothing with the switch off, and still deletes", async () => {
    const owner = await kit();
    await photoOn(owner);
    await syncPublicPhotos(deps({ newKey: keys("k1") }), only(owner.entryId));
    const fresh = await photoOn(owner, "pass", 1);
    const [first] = await copies();
    await core()
      .update(entryPhotos)
      .set({ screenStatus: "hidden_pending_review" })
      .where(eq(entryPhotos.id, first?.photoId ?? ""));

    expect(
      await syncPublicPhotos(
        deps({ isPublishing: false }),
        only(owner.entryId),
      ),
    ).toBe(1);

    expect(await bucketKeys()).toStrictEqual([]);
    expect(await copies()).toStrictEqual([]);
    // The photo still owed a copy got none.
    expect(
      await core()
        .select()
        .from(publicPhotos)
        .where(eq(publicPhotos.photoId, fresh)),
    ).toStrictEqual([]);
  });

  it("reaches only the kits and runners named", async () => {
    const named = await kit();
    const other = await kit();
    const untouched = await kit();
    await photoOn(named);
    await photoOn(other);
    await photoOn(untouched);

    await syncPublicPhotos(deps(), only(named.entryId));

    expect(await copiedEntries()).toStrictEqual([named.entryId]);

    await syncPublicPhotos(deps(), { entryIds: [], runnerIds: [other.userId] });

    expect(new Set(await copiedEntries())).toStrictEqual(
      new Set([named.entryId, other.entryId]),
    );
  });

  it("deletes only the named runner's stale copies", async () => {
    const named = await kit();
    const other = await kit();
    await photoOn(named);
    await photoOn(other);
    await syncPublicPhotos(deps(), {
      entryIds: [named.entryId, other.entryId],
      runnerIds: [],
    });
    await core().delete(entryPhotos);

    expect(
      await syncPublicPhotos(deps(), {
        entryIds: [],
        runnerIds: [named.userId],
      }),
    ).toBe(1);

    expect(await copiedEntries()).toStrictEqual([other.entryId]);
  });

  it("reaches a kit past the first IN list", async () => {
    const owner = await kit();
    await photoOn(owner);
    const others = Array.from({ length: 80 }, () => newUlid());

    await syncPublicPhotos(deps(), {
      entryIds: [...others, owner.entryId],
      runnerIds: [],
    });

    expect(await copies()).toHaveLength(1);
  });

  it("puts a claimed copy that never landed under the key it claimed", async () => {
    const owner = await kit();
    const photoId = await photoOn(owner);
    await core().insert(publicPhotos).values({
      key: "claimed",
      photoId,
      entryId: owner.entryId,
      userId: owner.userId,
      createdAt: NOW,
    });

    await syncPublicPhotos(
      deps({ newKey: keys("other") }),
      only(owner.entryId),
    );

    expect(await bucketKeys()).toStrictEqual(["claimed"]);
    const [copy] = await copies();
    expect(copy?.key).toBe("claimed");
    expect(copy?.publishedAt).not.toBeNull();
  });

  it("leaves a copy that landed alone", async () => {
    const owner = await kit();
    await photoOn(owner);
    const put = vi.spyOn(env.PUBLIC_PHOTOS, "put");
    try {
      await syncPublicPhotos(deps(), only(owner.entryId));
      await syncPublicPhotos(deps(), only(owner.entryId));

      expect(put).toHaveBeenCalledTimes(1);
    } finally {
      put.mockRestore();
    }
  });

  it("shares one key between two passes copying the same photo at once", async () => {
    const owner = await kit();
    await photoOn(owner);
    const report = vi.fn();
    const pass = (key: string) =>
      syncPublicPhotos(
        deps({ report, newKey: keys(key) }),
        only(owner.entryId),
      );

    await Promise.all([pass("a"), pass("b")]);

    const rows = await copies();
    expect(rows).toHaveLength(1);
    expect(await bucketKeys()).toStrictEqual([rows[0]?.key]);
    expect(report).not.toHaveBeenCalled();
  });

  it("withdraws a copy whose kit was taken back while the bytes were in flight", async () => {
    const owner = await kit();
    await photoOn(owner);
    const media: PublicPhotoDeps["media"] = {
      get: async (key) => {
        const object = await env.MEDIA.get(key);
        await core()
          .update(outfitEntries)
          .set({ audience: "private" })
          .where(eq(outfitEntries.id, owner.entryId));
        return object;
      },
    };

    await syncPublicPhotos(deps({ media }), only(owner.entryId));

    expect(await bucketKeys()).toStrictEqual([]);
    expect(await copies()).toStrictEqual([]);
  });

  it("reports a copy that fails by the photo's id, and copies the rest", async () => {
    const owner = await kit();
    const failing = await photoOn(owner, "pass", 0);
    const missing = await photoOn(owner, "pass", 1);
    const fine = await photoOn(owner, "pass", 2);
    const [missingRow] = await core()
      .select({ photoKey: entryPhotos.photoKey })
      .from(entryPhotos)
      .where(eq(entryPhotos.id, missing));
    await env.MEDIA.delete(missingRow?.photoKey ?? "");
    const report = vi.fn();
    const refusal = new Error("R2 down");
    const bucket: PublicPhotoDeps["bucket"] = {
      put: async (key, value, options) => {
        if (key === "first") throw refusal;
        return env.PUBLIC_PHOTOS.put(key, value, options);
      },
      delete: (key) => env.PUBLIC_PHOTOS.delete(key),
      list: (options) => env.PUBLIC_PHOTOS.list(options),
    };

    await syncPublicPhotos(
      deps({ bucket, report, newKey: keys("first", "second", "third") }),
      only(owner.entryId),
    );

    expect(report.mock.calls).toStrictEqual([
      [refusal, { photoId: failing }],
      [new Error("photo object missing"), { photoId: missing }],
    ]);
    expect(await bucketKeys()).toStrictEqual(["third"]);
    const rows = await copies();
    const landed = rows.filter((copy) => copy.publishedAt !== null);
    expect(landed.map((copy) => copy.photoId)).toStrictEqual([fine]);
  });
});

/**
A PUBLIC kit whose one photo is copied under `k1`.
*/
async function copied(): Promise<Kit & { photoId: string }> {
  const owner = await kit();
  const photoId = await photoOn(owner);
  await syncPublicPhotos(deps({ newKey: keys("k1") }), only(owner.entryId));
  expect(await bucketKeys()).toStrictEqual(["k1"]);
  return { ...owner, photoId };
}

describe("deleting", () => {
  it.each<[string, (copy: Kit & { photoId: string }) => Promise<unknown>]>([
    [
      "the kit leaves PUBLIC",
      ({ entryId }) =>
        core()
          .update(outfitEntries)
          .set({ audience: "runners" })
          .where(eq(outfitEntries.id, entryId)),
    ],
    [
      "the kit is hidden",
      ({ entryId }) =>
        core()
          .update(outfitEntries)
          .set({ moderationStatus: "hidden_pending_review" })
          .where(eq(outfitEntries.id, entryId)),
    ],
    [
      "the photo is held",
      ({ photoId }) =>
        core()
          .update(entryPhotos)
          .set({ screenStatus: "removed" })
          .where(eq(entryPhotos.id, photoId)),
    ],
    [
      "the photo is deleted",
      ({ photoId }) =>
        core().delete(entryPhotos).where(eq(entryPhotos.id, photoId)),
    ],
    [
      "the kit is deleted",
      ({ entryId }) =>
        core().delete(outfitEntries).where(eq(outfitEntries.id, entryId)),
    ],
  ])("deletes the copy, then its row, when %s", async (_label, takeBack) => {
    const owned = await copied();
    await takeBack(owned);

    expect(await syncPublicPhotos(deps(), only(owned.entryId))).toBe(1);

    expect(await bucketKeys()).toStrictEqual([]);
    expect(await copies()).toStrictEqual([]);
  });

  it("deletes by the runner's reach as well as the kit's", async () => {
    const owned = await copied();
    await core().delete(outfitEntries);

    await syncPublicPhotos(deps(), { entryIds: [], runnerIds: [owned.userId] });

    expect(await bucketKeys()).toStrictEqual([]);
  });

  it("keeps the row when the object's delete fails, for the next pass", async () => {
    const owned = await copied();
    await core().delete(entryPhotos);
    const report = vi.fn();
    const refusal = new Error("R2 down");
    const bucket: PublicPhotoDeps["bucket"] = {
      put: vi.fn(),
      delete: () => Promise.reject(refusal),
      list: vi.fn(),
    };

    expect(
      await syncPublicPhotos(deps({ bucket, report }), only(owned.entryId)),
    ).toBe(0);

    expect(report.mock.calls).toStrictEqual([
      [refusal, { photoId: owned.photoId }],
    ]);
    const [kept] = await copies();
    expect(kept?.key).toBe("k1");
  });

  it("keeps a copy the rule still admits", async () => {
    const owned = await copied();

    expect(await syncPublicPhotos(deps(), only(owned.entryId))).toBe(0);

    expect(await bucketKeys()).toStrictEqual(["k1"]);
  });
});

describe("the sweep", () => {
  it("deletes stale copies anywhere and counts them", async () => {
    const owner = await kit();
    await photoOn(owner);
    await syncPublicPhotos(deps(), only(owner.entryId));
    await core().delete(entryPhotos);

    expect(await sweepPublicPhotos(deps())).toStrictEqual({
      stale: 1,
      unnamed: 0,
    });
    expect(await bucketKeys()).toStrictEqual([]);
  });

  it("copies what no fast path saw", async () => {
    const owner = await kit();
    await photoOn(owner);

    expect(await sweepPublicPhotos(deps())).toStrictEqual({
      stale: 0,
      unnamed: 0,
    });
    expect(await bucketKeys()).toHaveLength(1);
  });

  it("deletes every object no row names, a page at a time", async () => {
    // Named copies fill the first page, so only following the cursor
    // reaches the orphans after them.
    const owner = await kit();
    await photoOn(owner, "pass", 0);
    await photoOn(owner, "pass", 1);
    await syncPublicPhotos(
      deps({ newKey: keys("a-named", "b-named") }),
      only(owner.entryId),
    );
    for (const key of ["c-orphan", "d-orphan", "e-orphan"]) {
      await env.PUBLIC_PHOTOS.put(key, BYTES);
    }
    const bucket: PublicPhotoDeps["bucket"] = {
      put: (key, value, options) => env.PUBLIC_PHOTOS.put(key, value, options),
      delete: (key) => env.PUBLIC_PHOTOS.delete(key),
      list: (options) => env.PUBLIC_PHOTOS.list({ ...options, limit: 2 }),
    };

    expect(await sweepPublicPhotos(deps({ bucket }))).toStrictEqual({
      stale: 0,
      unnamed: 3,
    });
    expect(await bucketKeys()).toStrictEqual(["a-named", "b-named"]);
  });

  it("finds nothing in an empty bucket", async () => {
    expect(await sweepPublicPhotos(deps())).toStrictEqual({
      stale: 0,
      unnamed: 0,
    });
  });

  it("names what it fixed in the digest, and nothing when it fixed nothing", async () => {
    const owner = await kit();
    await photoOn(owner);
    await syncPublicPhotos(deps(), only(owner.entryId));
    await core().delete(entryPhotos);
    await env.PUBLIC_PHOTOS.put("orphan", BYTES);
    const anomalies: string[] = [];

    await sweepPublicPhotoCopies(anomalies, deps());
    await sweepPublicPhotoCopies(anomalies, deps());

    expect(anomalies).toStrictEqual([
      "1 public photo copies were still up after their kit or photo stopped being public",
      "1 public photo objects had no row naming them and were deleted",
    ]);
  });
});

describe("the page's photos", () => {
  it("lists the landed copies of screened photos, in the kit's order, on the origin", async () => {
    const owner = await kit();
    await photoOn(owner, "pass", 1);
    await photoOn(owner, "pass", 0);
    await syncPublicPhotos(
      deps({ newKey: keys("second", "first") }),
      only(owner.entryId),
    );
    const unlanded = await photoOn(owner, "pass", 2);
    await core().insert(publicPhotos).values({
      key: "owed",
      photoId: unlanded,
      entryId: owner.entryId,
      userId: owner.userId,
      createdAt: NOW,
    });

    expect(await publishedPhotoUrls(core(), owner.entryId)).toStrictEqual([
      "https://photos.dialed.run/first",
      "https://photos.dialed.run/second",
    ]);

    await core()
      .update(entryPhotos)
      .set({ screenStatus: "hidden_pending_review" })
      .where(eq(entryPhotos.position, 0));

    expect(await publishedPhotoUrls(core(), owner.entryId)).toStrictEqual([
      "https://photos.dialed.run/second",
    ]);
    expect(
      await publishedPhotoUrls(core(), owner.entryId, "https://elsewhere.test"),
    ).toStrictEqual(["https://elsewhere.test/second"]);
    expect(await publishedPhotoUrls(core(), newUlid())).toStrictEqual([]);
  });

  it("lists none with the switch off", async () => {
    const owner = await kit();
    await photoOn(owner);
    await syncPublicPhotos(deps(), only(owner.entryId));

    expect(await publishedPhotoUrls(core(), owner.entryId, "")).toStrictEqual(
      [],
    );
    // The Worker's own switch, on in the test pool as in production.
    expect(await publishedPhotoUrls(core(), owner.entryId)).toHaveLength(1);
  });
});

describe("the switch and the Worker's wiring", () => {
  it("is on with an origin, and off with none or an empty one", () => {
    expect(publicPhotosOrigin("https://photos.dialed.run")).toBe(
      "https://photos.dialed.run",
    );
    expect(publicPhotosOrigin("")).toBeUndefined();
    expect(publicPhotosOrigin(undefined)).toBeUndefined();
    // The test pool's config sets it, as production's does.
    expect(env.PUBLIC_PHOTOS_ORIGIN).toBe(PUBLIC_PHOTOS_ORIGIN);
  });

  it("copies from the photos to the public bucket, with fresh keys and Sentry", () => {
    const wired = workerPublicPhotos();

    expect(wired.media).toBe(env.MEDIA);
    expect(wired.bucket).toBe(env.PUBLIC_PHOTOS);
    expect(wired.isPublishing).toBe(true);
    expect(wired.newKey).toBe(newPublicPhotoKey);
    expect(wired.report).toBe(captureException);
    // The switch off: still wired to delete, copying nothing.
    expect(workerPublicPhotos("").isPublishing).toBe(false);
  });

  it("syncs a scope in the background, and nothing for an empty one", async () => {
    const owner = await kit();
    await photoOn(owner);
    const kept: Promise<unknown>[] = [];
    const keepAlive = (promise: Promise<unknown>) => {
      kept.push(promise);
    };

    syncPublicPhotosLater({ entryIds: [], runnerIds: [] }, keepAlive, deps);
    expect(kept).toHaveLength(0);

    syncPublicPhotosLater(
      { entryIds: [], runnerIds: [owner.userId] },
      keepAlive,
      deps,
    );
    syncPublicPhotosLater(only(newUlid()), keepAlive, deps);
    syncPublicPhotosLater(
      { entryIds: [newUlid()], runnerIds: [newUlid()] },
      keepAlive,
      deps,
    );
    await Promise.all(kept);

    expect(kept).toHaveLength(3);
    expect(await copies()).toHaveLength(1);
  });

  it("reports a sync that fails outright, never rejecting", async () => {
    const report = vi.fn();
    const failure = new Error("D1 down");
    const kept: Promise<unknown>[] = [];
    const db = core();
    vi.spyOn(db, "select").mockImplementation(() => {
      throw failure;
    });
    const broken = deps({ report, db });

    syncPublicPhotosLater(
      only(newUlid()),
      (promise) => {
        kept.push(promise);
      },
      () => broken,
    );
    await Promise.all(kept);

    expect(report.mock.calls).toStrictEqual([
      [failure, { scope: "public photos" }],
    ]);
  });
});
