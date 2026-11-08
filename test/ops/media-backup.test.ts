import { describe, expect, it } from "vitest";

import { env } from "../../src/env";
import { quarantineKeyFor } from "../../src/lib/entry-photo-key";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import {
  BACKED_UP_PREFIXES,
  backUpMedia,
  GONE_PREFIX,
  GONE_RETENTION_S,
  MAX_COPIES_PER_FIRING,
} from "../../src/modules/ops/media-backup";

/**
 * The daily photo backup (D-172, #420, design 186), against the test
 * pool's real R2 buckets. Each test works under a prefix of its own, so
 * what another test left in `MEDIA` cannot change what this one sees.
 */

function backupBucket(): R2Bucket {
  const bucket = env.MEDIA_BACKUP;
  if (bucket === undefined) throw new Error("the test pool binds MEDIA_BACKUP");
  return bucket;
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
  await backUpMedia({ source: env.MEDIA, backup: backupBucket() }, anomalies, {
    now: options.now ?? nowSeconds(),
    prefixes: [prefix],
    ...(options.maxCopies !== undefined && { maxCopies: options.maxCopies }),
  });
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
      { source: env.MEDIA, backup: backupBucket() },
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

    await backUpMedia({ source: env.MEDIA, backup: bucket }, [], {
      now: nowSeconds(),
      prefixes: [prefix],
    });

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

    await backUpMedia({ source: paged, backup: backupBucket() }, [], {
      now: nowSeconds(),
      prefixes: [prefix],
    });

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
      { source: vanishing, backup: backupBucket() },
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

    await backUpMedia({ source: failing, backup: backupBucket() }, anomalies, {
      now: nowSeconds(),
      prefixes: [prefix],
    });

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

    await backUpMedia({ source: env.MEDIA, backup: counting }, [], {
      now: nowSeconds() + 2 * GONE_RETENTION_S,
      prefixes: [freshPrefix()],
    });

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

    await backUpMedia({ source: env.MEDIA, backup: refusing }, anomalies, {
      now: nowSeconds(),
      prefixes: [prefix],
    });

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

    await backUpMedia({ source: env.MEDIA, backup: refusing }, anomalies, {
      now: nowSeconds() + 2 * GONE_RETENTION_S,
      prefixes: [freshPrefix()],
    });

    expect(anomalies).toStrictEqual([
      "media-backup: 1 copies or deletes failed; the next firing retries them",
    ]);
  });
});

describe("without the binding", () => {
  it("backs up nothing and says so every day (law 5)", async () => {
    const anomalies: string[] = [];

    await backUpMedia({ source: env.MEDIA, backup: undefined }, anomalies, {
      now: nowSeconds(),
    });

    expect(anomalies).toStrictEqual([
      "media-backup: MEDIA_BACKUP is not bound, so no photo is backed up",
    ]);
  });
});
