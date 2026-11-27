import { afterEach, describe, expect, it, vi } from "vitest";

import { env } from "../../src/env";
import { quarantineKeyFor } from "../../src/lib/entry-photo-key";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import {
  BACKED_UP_PREFIXES,
  backUpMedia,
  dropBackupCopies,
  GONE_PREFIX,
  GONE_RETENTION_S,
  MAX_COPIES_PER_FIRING,
} from "../../src/modules/ops/daily/media-backup";

/**
 * The daily photo backup (D-172, #420, design 186), against the test
 * pool's real R2 buckets. Each test works under a prefix of its own, so
 * what another test left in `MEDIA` cannot change what this one sees.
 */

function backupBucket(): R2Bucket {
  return env.MEDIA_BACKUP;
}

/**
No quarantine record covers anything.
*/
function none(): Promise<readonly string[]> {
  return Promise.resolve([]);
}

/**
A fresh prefix under the garment photos, unique to the calling test.
*/
function freshPrefix(): string {
  return `items/${newUlid()}/`;
}

/**
The backup bucket, counting the puts made through it.
*/
type BackupLike = Pick<R2Bucket, "list" | "get" | "put" | "delete">;

function countingPuts(bucket: R2Bucket): {
  bucket: BackupLike;
  puts: string[];
} {
  const puts: string[] = [];
  return {
    puts,
    bucket: {
      list: (options) => bucket.list(options),
      get: (key: string) => bucket.get(key),
      put: (key, value, options) => {
        puts.push(key);
        return bucket.put(key, value, options);
      },
      delete: (keys) => bucket.delete(keys),
    },
  };
}

async function run(
  prefix: string,
  options: { now?: number; maxCopies?: number } = {},
): Promise<string[]> {
  const anomalies: string[] = [];
  await backUpMedia(
    { source: env.MEDIA, backup: backupBucket(), quarantined: none },
    anomalies,
    {
      now: options.now ?? nowSeconds(),
      prefixes: [prefix],
      ...(options.maxCopies !== undefined && { maxCopies: options.maxCopies }),
    },
  );
  return anomalies;
}

describe("what it backs up", () => {
  it("is the garment and entry photos, read from the key helpers", () => {
    expect(BACKED_UP_PREFIXES).toStrictEqual(["items/", "entries/"]);
    expect(MAX_COPIES_PER_FIRING).toBe(1000);
    expect(GONE_PREFIX).toBe("gone/");
    expect(GONE_RETENTION_S).toBe(30 * 24 * 60 * 60);
  });

  it("never copies quarantine/ or products/, with the default prefixes (#530)", async () => {
    const id = newUlid();
    const entryKey = `entries/${id}/entry/photo`;
    const quarantined = quarantineKeyFor(`entries/${id}/other/photo`);
    const product = `products/${id}/image-1`;
    for (const key of [entryKey, quarantined, product]) {
      await env.MEDIA.put(key, key);
    }
    const anomalies: string[] = [];

    await backUpMedia(
      { source: env.MEDIA, backup: backupBucket(), quarantined: none },
      anomalies,
      {
        now: nowSeconds(),
      },
    );

    expect(await backupBucket().head(entryKey)).not.toBeNull();
    expect(await backupBucket().head(quarantined)).toBeNull();
    expect(await backupBucket().head(product)).toBeNull();
    expect(anomalies).toStrictEqual([]);
  });
});

describe("copying", () => {
  it("copies again over a backup object that carries no source etag", async () => {
    const prefix = freshPrefix();
    const key = `${prefix}a`;
    const stored = await env.MEDIA.put(key, "real");
    // Put there by hand, say, with no metadata at all.
    await backupBucket().put(key, "stray");

    expect(await run(prefix)).toStrictEqual([]);

    const copy = await backupBucket().get(key);
    expect(await copy?.text()).toBe("real");
    expect(copy?.customMetadata).toStrictEqual({ sourceEtag: stored?.etag });
  });

  it("copies a new photo with its metadata and the source's etag", async () => {
    const prefix = freshPrefix();
    const key = `${prefix}item/original.jpg`;
    const stored = await env.MEDIA.put(key, "jpeg bytes", {
      httpMetadata: { contentType: "image/jpeg" },
      customMetadata: { variant: "original" },
    });

    expect(await run(prefix)).toStrictEqual([]);

    const copy = await backupBucket().get(key);
    expect(await copy?.text()).toBe("jpeg bytes");
    expect(copy?.httpMetadata?.contentType).toBe("image/jpeg");
    expect(copy?.customMetadata).toStrictEqual({
      variant: "original",
      sourceEtag: stored.etag,
    });
  });

  it("leaves a copy alone while the source is unchanged", async () => {
    const prefix = freshPrefix();
    await env.MEDIA.put(`${prefix}a`, "a");
    await run(prefix);
    const { bucket, puts } = countingPuts(backupBucket());

    await backUpMedia(
      { source: env.MEDIA, backup: bucket, quarantined: none },
      [],
      {
        now: nowSeconds(),
        prefixes: [prefix],
      },
    );

    expect(puts).toStrictEqual([]);
  });

  it("copies an overwritten photo again", async () => {
    const prefix = freshPrefix();
    const key = `${prefix}a`;
    await env.MEDIA.put(key, "first");
    await run(prefix);
    await env.MEDIA.put(key, "second");

    await run(prefix);

    const copy = await backupBucket().get(key);
    expect(await copy?.text()).toBe("second");
  });

  it("walks every page of a listing", async () => {
    const prefix = freshPrefix();
    for (const name of ["a", "b", "c"]) {
      await env.MEDIA.put(`${prefix}${name}`, name);
    }
    // One object a page, so only following the cursor reaches the third.
    const paged: Pick<R2Bucket, "list" | "get"> = {
      list: (options) => env.MEDIA.list({ ...options, limit: 1 }),
      get: (key: string) => env.MEDIA.get(key),
    };

    await backUpMedia(
      { source: paged, backup: backupBucket(), quarantined: none },
      [],
      {
        now: nowSeconds(),
        prefixes: [prefix],
      },
    );

    const copied = await backupBucket().list({ prefix });
    expect(copied.objects.map((object) => object.key)).toStrictEqual([
      `${prefix}a`,
      `${prefix}b`,
      `${prefix}c`,
    ]);
  });

  it("copies at most the cap a firing, and says how many are left", async () => {
    const prefix = freshPrefix();
    for (const name of ["a", "b", "c"]) {
      await env.MEDIA.put(`${prefix}${name}`, name);
    }

    const anomalies = await run(prefix, { maxCopies: 2 });

    const copied = await backupBucket().list({ prefix });
    expect(copied.objects).toHaveLength(2);
    expect(anomalies).toStrictEqual([
      "media-backup: 1 photos left for the next firing (2 a day)",
    ]);
    // The next firing takes the rest.
    expect(await run(prefix, { maxCopies: 2 })).toStrictEqual([]);
    const all = await backupBucket().list({ prefix });
    expect(all.objects).toHaveLength(3);
  });

  it("does not count a photo deleted between the listing and the copy", async () => {
    const prefix = freshPrefix();
    for (const name of ["a", "b"]) {
      await env.MEDIA.put(`${prefix}${name}`, name);
    }
    // Listed, then deleted before its copy is made.
    const vanishing: Pick<R2Bucket, "list" | "get"> = {
      list: async (options) => {
        const listed = await env.MEDIA.list(options);
        await env.MEDIA.delete(`${prefix}a`);
        return listed;
      },
      get: (key: string) => env.MEDIA.get(key),
    };
    const anomalies: string[] = [];

    await backUpMedia(
      { source: vanishing, backup: backupBucket(), quarantined: none },
      anomalies,
      {
        now: nowSeconds(),
        prefixes: [prefix],
        maxCopies: 1,
      },
    );

    // The vanished one used none of the cap, so the other was copied.
    expect(await backupBucket().head(`${prefix}b`)).not.toBeNull();
    expect(anomalies).toStrictEqual([]);
  });

  it("reports a copy that failed, and copies the rest", async () => {
    const prefix = freshPrefix();
    for (const name of ["a", "b"]) {
      await env.MEDIA.put(`${prefix}${name}`, name);
    }
    const failing: Pick<R2Bucket, "list" | "get"> = {
      list: (options) => env.MEDIA.list(options),
      get: (key: string) =>
        key.endsWith("a")
          ? Promise.reject(new Error("R2 is down"))
          : env.MEDIA.get(key),
    };
    const anomalies: string[] = [];

    await backUpMedia(
      { source: failing, backup: backupBucket(), quarantined: none },
      anomalies,
      {
        now: nowSeconds(),
        prefixes: [prefix],
      },
    );

    expect(await backupBucket().head(`${prefix}b`)).not.toBeNull();
    expect(anomalies).toStrictEqual([
      "media-backup: 1 copies or deletes failed; the next firing retries them",
    ]);
  });
});

describe("a photo deleted from MEDIA (#529)", () => {
  it("moves its copy to gone/, metadata and all", async () => {
    const prefix = freshPrefix();
    const key = `${prefix}a`;
    const stored = await env.MEDIA.put(key, "a", {
      httpMetadata: { contentType: "image/jpeg" },
    });
    await run(prefix);
    await env.MEDIA.delete(key);

    expect(await run(prefix)).toStrictEqual([]);

    expect(await backupBucket().head(key)).toBeNull();
    const gone = await backupBucket().get(`${GONE_PREFIX}${key}`);
    expect(await gone?.text()).toBe("a");
    expect(gone?.httpMetadata?.contentType).toBe("image/jpeg");
    expect(gone?.customMetadata).toStrictEqual({ sourceEtag: stored.etag });
  });

  it("keeps a gone/ copy for 30 days, then deletes it", async () => {
    const prefix = freshPrefix();
    const key = `${prefix}a`;
    await env.MEDIA.put(key, "a");
    await run(prefix);
    await env.MEDIA.delete(key);
    await run(prefix);
    const gone = await backupBucket().head(`${GONE_PREFIX}${key}`);
    // To the millisecond: exactly 30 days is still kept.
    const wentAt = (gone?.uploaded.getTime() ?? 0) / 1000;

    await run(prefix, { now: wentAt + GONE_RETENTION_S });
    expect(await backupBucket().head(`${GONE_PREFIX}${key}`)).not.toBeNull();

    await run(prefix, { now: wentAt + GONE_RETENTION_S + 1 });
    expect(await backupBucket().head(`${GONE_PREFIX}${key}`)).toBeNull();
  });

  it("deletes expired copies a thousand keys a call, R2's most", async () => {
    const real = backupBucket();
    const mine = `${GONE_PREFIX}${freshPrefix()}`;
    // Exactly two thousand, so a loop that ran once too often would send
    // an empty third call.
    const keys = Array.from(
      { length: 2000 },
      (_, index) => `${mine}${String(index)}`,
    );
    await Promise.all(keys.map((key) => real.put(key, "x")));
    const batches: number[] = [];
    const counting: BackupLike = {
      // gone/ narrowed to this test's keys, whatever others left there.
      list: (options) =>
        real.list(
          options?.prefix === GONE_PREFIX
            ? { ...options, prefix: mine }
            : options,
        ),
      get: (key: string) => real.get(key),
      put: (key, value, options) => real.put(key, value, options),
      delete: (deleted) => {
        batches.push(Array.isArray(deleted) ? deleted.length : 1);
        return real.delete(deleted);
      },
    };

    await backUpMedia(
      { source: env.MEDIA, backup: counting, quarantined: none },
      [],
      {
        now: nowSeconds() + 2 * GONE_RETENTION_S,
        prefixes: [freshPrefix()],
      },
    );

    expect(batches).toStrictEqual([1000, 1000]);
    const left = await real.list({ prefix: mine });
    expect(left.objects).toStrictEqual([]);
  });

  it("reports a move that failed, and keeps the copy where it was", async () => {
    const prefix = freshPrefix();
    const key = `${prefix}a`;
    await env.MEDIA.put(key, "a");
    await run(prefix);
    await env.MEDIA.delete(key);
    const real = backupBucket();
    const refusing: BackupLike = {
      list: (options) => real.list(options),
      get: (k: string) => real.get(k),
      put: () => Promise.reject(new Error("R2 is down")),
      delete: (keys) => real.delete(keys),
    };
    const anomalies: string[] = [];

    await backUpMedia(
      { source: env.MEDIA, backup: refusing, quarantined: none },
      anomalies,
      {
        now: nowSeconds(),
        prefixes: [prefix],
      },
    );

    expect(await real.head(key)).not.toBeNull();
    expect(anomalies).toStrictEqual([
      "media-backup: 1 copies or deletes failed; the next firing retries them",
    ]);
  });

  it("reports an expiry that failed", async () => {
    const real = backupBucket();
    await real.put(`${GONE_PREFIX}${freshPrefix()}a`, "a");
    const refusing: BackupLike = {
      list: (options) => real.list(options),
      get: (k: string) => real.get(k),
      put: (k, value, options) => real.put(k, value, options),
      delete: () => Promise.reject(new Error("R2 is down")),
    };
    const anomalies: string[] = [];

    await backUpMedia(
      { source: env.MEDIA, backup: refusing, quarantined: none },
      anomalies,
      {
        now: nowSeconds() + 2 * GONE_RETENTION_S,
        prefixes: [freshPrefix()],
      },
    );

    expect(anomalies).toStrictEqual([
      "media-backup: 1 copies or deletes failed; the next firing retries them",
    ]);
  });
});

/**
Every key the backup holds under these prefixes, in the order R2 lists them.
*/
async function heldUnder(...prefixes: string[]): Promise<string[]> {
  const held: string[] = [];
  for (const prefix of prefixes) {
    const listed = await backupBucket().list({ prefix });
    held.push(...listed.objects.map((object) => object.key));
  }
  return held;
}

/**
Quarantine records that cover exactly these scopes.
*/
function covering(...scopes: string[]): () => Promise<readonly string[]> {
  return () => Promise.resolve(scopes);
}

async function runCovering(
  prefix: string,
  scopes: readonly string[],
  backup: BackupLike = backupBucket(),
): Promise<string[]> {
  const anomalies: string[] = [];
  await backUpMedia(
    { source: env.MEDIA, backup, quarantined: covering(...scopes) },
    anomalies,
    { now: nowSeconds(), prefixes: [prefix] },
  );
  return anomalies;
}

describe("a photo a quarantine record covers (D-70)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is never copied, even while its source is still there", async () => {
    const prefix = freshPrefix();
    const key = `${prefix}photo`;
    await env.MEDIA.put(key, "held");

    expect(await runCovering(prefix, [key])).toStrictEqual([]);

    expect(await heldUnder(prefix, `${GONE_PREFIX}${prefix}`)).toStrictEqual(
      [],
    );
  });

  it("has its copy deleted, never set aside, whether its source is there or gone", async () => {
    const prefix = freshPrefix();
    const kept = `${prefix}kept`;
    const deleted = `${prefix}deleted`;
    await env.MEDIA.put(kept, "kept");
    await env.MEDIA.put(deleted, "deleted");
    await run(prefix);
    await env.MEDIA.delete(deleted);

    expect(await runCovering(prefix, [kept, deleted])).toStrictEqual([]);

    expect(await heldUnder(prefix, `${GONE_PREFIX}${prefix}`)).toStrictEqual(
      [],
    );
  });

  it("has its gone/ copy deleted at any age, and another's kept", async () => {
    const prefix = freshPrefix();
    const key = `${prefix}photo`;
    const other = `${prefix}other`;
    for (const each of [key, other]) {
      await backupBucket().put(`${GONE_PREFIX}${each}`, "set aside today");
    }

    expect(await runCovering(freshPrefix(), [key])).toStrictEqual([]);

    expect(await heldUnder(`${GONE_PREFIX}${prefix}`)).toStrictEqual([
      `${GONE_PREFIX}${other}`,
    ]);
  });

  it("covers the scope itself and what is beneath it, never a key beside it", async () => {
    const prefix = freshPrefix();
    // A kit's prefix, a garment photo's version, and a kit photo's key.
    const kit = `${prefix}kit/`;
    const version = `${prefix}version`;
    const photo = `${prefix}photo`;
    const covered = [`${kit}a`, `${version}/card.webp`, photo];
    const beside = [`${prefix}kitx/a`, `${version}x/card.webp`, `${photo}x`];
    for (const key of [...covered, ...beside]) await env.MEDIA.put(key, key);

    expect(await runCovering(prefix, [kit, version, photo])).toStrictEqual([]);

    expect(await heldUnder(prefix)).toStrictEqual(
      beside.toSorted((a, b) => a.localeCompare(b)),
    );
  });

  it("copies nothing when the records cannot be read, and says why", async () => {
    const prefix = freshPrefix();
    await env.MEDIA.put(`${prefix}a`, "a");
    const failure = new Error("D1 is down");

    await expect(
      backUpMedia(
        {
          source: env.MEDIA,
          backup: backupBucket(),
          quarantined: () => Promise.reject(failure),
        },
        [],
        { now: nowSeconds(), prefixes: [prefix] },
      ),
    ).rejects.toBe(failure);

    expect(await heldUnder(prefix)).toStrictEqual([]);
  });

  it("reports a delete of its copy that failed, and keeps the copy for the next firing", async () => {
    const prefix = freshPrefix();
    const key = `${prefix}photo`;
    await env.MEDIA.put(key, "held");
    await run(prefix);
    const real = backupBucket();
    const refusing: BackupLike = {
      list: (options) => real.list(options),
      get: (k: string) => real.get(k),
      put: (k, value, options) => real.put(k, value, options),
      delete: () => Promise.reject(new Error("R2 is down")),
    };

    expect(await runCovering(prefix, [key], refusing)).toStrictEqual([
      "media-backup: 1 copies or deletes failed; the next firing retries them",
    ]);
    expect(await heldUnder(prefix)).toStrictEqual([key]);

    expect(await runCovering(prefix, [key])).toStrictEqual([]);
    expect(await heldUnder(prefix)).toStrictEqual([]);
  });
});

describe("dropBackupCopies", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("deletes a quarantine's copies under their keys and under gone/ at once, and nothing beside them", async () => {
    const prefix = freshPrefix();
    const photo = `${prefix}photo`;
    const kit = `${prefix}kit/`;
    for (const key of [photo, `${photo}x`, `${kit}a`]) {
      await backupBucket().put(key, key);
      await backupBucket().put(`${GONE_PREFIX}${key}`, key);
    }

    await dropBackupCopies(photo);
    await dropBackupCopies(kit);

    expect(await heldUnder(prefix, `${GONE_PREFIX}${prefix}`)).toStrictEqual([
      `${photo}x`,
      `${GONE_PREFIX}${photo}x`,
    ]);
  });

  it("deletes nothing, and calls no delete, when the backup holds none", async () => {
    const real = backupBucket();
    const deletes = vi.spyOn(real, "delete");

    await dropBackupCopies(`${freshPrefix()}photo`, real);

    expect(deletes).not.toHaveBeenCalled();
  });

  it("throws what R2 throws, for its caller to report", async () => {
    const prefix = freshPrefix();
    await backupBucket().put(`${prefix}photo`, "photo");
    const failure = new Error("R2 is down");
    vi.spyOn(backupBucket(), "delete").mockRejectedValueOnce(failure);

    await expect(dropBackupCopies(`${prefix}photo`)).rejects.toBe(failure);
  });
});
