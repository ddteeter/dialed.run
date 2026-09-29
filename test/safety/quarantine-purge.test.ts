import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { quarantinedContent } from "../../src/db/schema-core";
import { env } from "../../src/env";
import {
  entryPhotoKeyFor,
  quarantineKeyFor,
} from "../../src/lib/entry-photo-key";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { handleScheduled } from "../../src/modules/ops";
import {
  preservedKeysOf,
  purgeExpiredQuarantine,
  QUARANTINE_PURGE_CAP,
  QUARANTINE_PURGE_LEASE_SECONDS,
} from "../../src/modules/safety/quarantine";

/**
 * The quarantine's year (decision D-70): silent, everything kept a year,
 * then the preserved copies and the record go. Each test observes R2 and
 * the table, never the function's own bookkeeping alone.
 */

const DIGEST = { cron: "0 12 * * *" } as ScheduledController;
const DAY = 24 * 60 * 60;

function core() {
  return drizzle(env.DIALED_CORE);
}

async function emptyQuarantine(): Promise<void> {
  await core().delete(quarantinedContent);
  const listed = await env.MEDIA.list({ prefix: "quarantine/" });
  await env.MEDIA.delete(listed.objects.map((object) => object.key));
}

/**
 * One quarantine as `moderateContent` leaves it: a copy of each photo
 * under `quarantine/`, and the record naming each copy in its snapshot.
 */
async function quarantined(options: {
  retainUntil: number;
  photos?: number;
  snapshot?: string;
}): Promise<{
  id: string;
  keys: string[];
  entryId: string;
  uploaderId: string;
}> {
  const uploaderId = newUlid();
  const entryId = newUlid();
  const keys = Array.from({ length: options.photos ?? 2 }, () =>
    quarantineKeyFor(entryPhotoKeyFor(uploaderId, entryId, newUlid())),
  );
  for (const key of keys) await env.MEDIA.put(key, "bytes");
  const id = newUlid();
  await core()
    .insert(quarantinedContent)
    .values({
      id,
      moderationActionId: newUlid(),
      subjectType: "entry",
      subjectId: entryId,
      uploaderId,
      entryId,
      entrySnapshot: "{}",
      photosSnapshot:
        options.snapshot ??
        JSON.stringify(
          keys.map((preservedKey) => ({ id: newUlid(), preservedKey })),
        ),
      quarantinedAt: options.retainUntil - 365 * DAY,
      retainUntil: options.retainUntil,
    });
  return { id, keys, entryId, uploaderId };
}

async function isStored(key: string): Promise<boolean> {
  return (await env.MEDIA.head(key)) !== null;
}

async function recordOf(id: string) {
  const [row] = await core()
    .select()
    .from(quarantinedContent)
    .where(eq(quarantinedContent.id, id));
  return row;
}

beforeEach(async () => {
  await emptyQuarantine();
});

/**
Silenced: the capture is what is asserted.
*/
function nothing(): void {
  // Nothing to print.
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("QUARANTINE_PURGE_LEASE_SECONDS", () => {
  it("is a full day, in seconds", () => {
    expect(QUARANTINE_PURGE_LEASE_SECONDS).toBe(86_400);
  });
});

describe("purgeExpiredQuarantine", () => {
  it("deletes an expired record and every copy it names", async () => {
    const expired = await quarantined({ retainUntil: nowSeconds() - DAY });

    const purge = await purgeExpiredQuarantine(core());

    expect(purge).toStrictEqual({ purged: 1, failed: [] });
    expect(await recordOf(expired.id)).toBeUndefined();
    for (const key of expired.keys) expect(await isStored(key)).toBe(false);
  });

  it("purges a record on the second its year ends, and keeps one a second short", async () => {
    const now = nowSeconds();
    const due = await quarantined({ retainUntil: now });
    const notYet = await quarantined({ retainUntil: now + 1 });

    await purgeExpiredQuarantine(core(), env.MEDIA, now);

    expect(await recordOf(due.id)).toBeUndefined();
    expect(await recordOf(notYet.id)).toMatchObject({ retainUntil: now + 1 });
    for (const key of notYet.keys) expect(await isStored(key)).toBe(true);
  });

  it("deletes only the copies its own record names, not the entry's whole prefix", async () => {
    // A photo quarantined, then the rest of the same entry: two records
    // under one entry's prefix, expiring on different days.
    const now = nowSeconds();
    const first = await quarantined({ retainUntil: now - DAY, photos: 1 });
    const [firstKey = ""] = first.keys;
    const sibling = quarantineKeyFor(
      entryPhotoKeyFor(first.uploaderId, first.entryId, newUlid()),
    );
    await env.MEDIA.put(sibling, "the later quarantine's copy");

    await purgeExpiredQuarantine(core(), env.MEDIA, now);

    expect(await isStored(firstKey)).toBe(false);
    expect(await isStored(sibling)).toBe(true);
  });

  it("never deletes a key outside the quarantine prefix, whatever the snapshot says", async () => {
    const live = entryPhotoKeyFor(newUlid(), newUlid(), newUlid());
    await env.MEDIA.put(live, "a runner's live photo");
    const record = await quarantined({
      retainUntil: nowSeconds() - DAY,
      snapshot: JSON.stringify([{ preservedKey: live }]),
    });

    const purge = await purgeExpiredQuarantine(core());

    expect(purge.purged).toBe(1);
    expect(await isStored(live)).toBe(true);
    expect(await recordOf(record.id)).toBeUndefined();
    await env.MEDIA.delete(live);
  });

  it("purges a record whose photos had no object to copy", async () => {
    const record = await quarantined({
      retainUntil: nowSeconds() - DAY,
      snapshot: JSON.stringify([{ id: newUlid() }]),
    });

    const purge = await purgeExpiredQuarantine(core());

    expect(purge).toStrictEqual({ purged: 1, failed: [] });
    expect(await recordOf(record.id)).toBeUndefined();
  });

  it("keeps the record when R2 refuses, due again once the lease has passed", async () => {
    const now = nowSeconds();
    const record = await quarantined({ retainUntil: now - DAY });
    const refusal = new Error("R2 unavailable");
    const failing = { delete: vi.fn().mockRejectedValue(refusal) };

    const purge = await purgeExpiredQuarantine(core(), failing, now);

    expect(purge).toStrictEqual({
      purged: 0,
      failed: [{ id: record.id, error: refusal }],
    });
    expect(failing.delete).toHaveBeenCalledWith(record.keys);
    expect(await recordOf(record.id)).toMatchObject({
      retainUntil: now + QUARANTINE_PURGE_LEASE_SECONDS,
    });
    for (const key of record.keys) expect(await isStored(key)).toBe(true);

    // Not before the lease passes, even to a second firing that day…
    const sameDay = await purgeExpiredQuarantine(
      core(),
      env.MEDIA,
      now + QUARANTINE_PURGE_LEASE_SECONDS - 1,
    );
    expect(sameDay.purged).toBe(0);
    // …and then it finishes.
    const nextDay = await purgeExpiredQuarantine(
      core(),
      env.MEDIA,
      now + QUARANTINE_PURGE_LEASE_SECONDS,
    );
    expect(nextDay).toStrictEqual({ purged: 1, failed: [] });
    expect(await recordOf(record.id)).toBeUndefined();
    for (const key of record.keys) expect(await isStored(key)).toBe(false);
  });

  it("keeps a record whose snapshot cannot be read, and says so", async () => {
    const now = nowSeconds();
    const record = await quarantined({
      retainUntil: now - DAY,
      snapshot: "not json",
    });

    const purge = await purgeExpiredQuarantine(core(), env.MEDIA, now);

    expect(purge.purged).toBe(0);
    expect(purge.failed).toHaveLength(1);
    expect(purge.failed[0]?.id).toBe(record.id);
    expect(String(purge.failed[0]?.error)).toContain(
      "quarantine snapshot unreadable: not JSON",
    );
    expect(await recordOf(record.id)).toMatchObject({
      retainUntil: now + QUARANTINE_PURGE_LEASE_SECONDS,
    });
    for (const key of record.keys) expect(await isStored(key)).toBe(true);
  });

  it("gives an overlapping purge nothing to claim", async () => {
    const now = nowSeconds();
    await quarantined({ retainUntil: now - DAY });
    const deletes = vi.fn().mockResolvedValue(undefined);

    const [one, other] = await Promise.all([
      purgeExpiredQuarantine(core(), { delete: deletes }, now),
      purgeExpiredQuarantine(core(), { delete: deletes }, now),
    ]);

    expect(one.purged + other.purged).toBe(1);
    expect(deletes).toHaveBeenCalledTimes(1);
  });

  it("takes the oldest first, and no more than the cap", async () => {
    const now = nowSeconds();
    const oldest = await quarantined({ retainUntil: now - 3 * DAY, photos: 0 });
    for (let index = 0; index < QUARANTINE_PURGE_CAP; index += 1) {
      await quarantined({ retainUntil: now - DAY, photos: 0 });
    }

    const purge = await purgeExpiredQuarantine(core(), env.MEDIA, now);

    expect(purge.purged).toBe(QUARANTINE_PURGE_CAP);
    expect(await recordOf(oldest.id)).toBeUndefined();
    expect(await core().$count(quarantinedContent)).toBe(1);
  });

  it("does nothing when nothing is due", async () => {
    const kept = await quarantined({ retainUntil: nowSeconds() + DAY });
    const deletes = vi.fn();

    const purge = await purgeExpiredQuarantine(core(), { delete: deletes });

    expect(purge).toStrictEqual({ purged: 0, failed: [] });
    expect(deletes).not.toHaveBeenCalled();
    expect(await recordOf(kept.id)).toBeDefined();
  });
});

describe("preservedKeysOf", () => {
  it("reads each photo's preserved key, skipping photos with none", () => {
    const key = quarantineKeyFor("entries/u/e/p");
    expect(
      preservedKeysOf(JSON.stringify([{ preservedKey: key }, { id: "p2" }])),
    ).toStrictEqual({ ok: true, keys: [key] });
  });

  it("names a snapshot that is not JSON apart from one of the wrong shape", () => {
    expect(preservedKeysOf("{")).toStrictEqual({
      ok: false,
      problem: "not JSON",
    });
    for (const wrong of [{ preservedKey: "x" }, [{ preservedKey: 7 }]]) {
      expect(preservedKeysOf(JSON.stringify(wrong))).toStrictEqual({
        ok: false,
        problem: "not a list of photos",
      });
    }
  });

  it("drops a key that only contains the prefix rather than starting with it", () => {
    expect(
      preservedKeysOf(
        JSON.stringify([{ preservedKey: "entries/quarantine/u/e/p" }]),
      ),
    ).toStrictEqual({ ok: true, keys: [] });
  });
});

describe("the daily digest", () => {
  it("purges what has expired", async () => {
    const expired = await quarantined({ retainUntil: nowSeconds() - DAY });

    await handleScheduled(DIGEST);

    expect(await recordOf(expired.id)).toBeUndefined();
    for (const key of expired.keys) expect(await isStored(key)).toBe(false);
  });

  it("reports a record it could not purge to Sentry, with its id", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(nothing);
    const record = await quarantined({
      retainUntil: nowSeconds() - DAY,
      snapshot: "not json",
    });

    await handleScheduled(DIGEST);

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("sentry-disabled"),
      expect.objectContaining({
        surface: "quarantine-purge",
        quarantineId: record.id,
      }),
      expect.anything(),
    );
    expect(await recordOf(record.id)).toBeDefined();
  });
});
