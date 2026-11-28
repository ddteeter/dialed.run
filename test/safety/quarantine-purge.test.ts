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
import { deleteKeys } from "../../src/lib/sql/r2-delete";
import { handleScheduled } from "../../src/modules/dispatch";
import {
  claimQuarantine,
  copiesNoRecordLists,
  dueQuarantine,
  preservedKeysOf,
  purgeExpiredQuarantine,
  QUARANTINE_PURGE_CAP,
  QUARANTINE_PURGE_LEASE_SECONDS,
  QUARANTINE_SWEEP_PAGES,
  QUARANTINE_LOCK_DAYS,
  QUARANTINE_UNLISTED_GRACE_SECONDS,
} from "../../src/modules/safety/takedowns/quarantine";

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
  await deleteKeys(
    env.MEDIA,
    listed.objects.map((object) => object.key),
  );
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

/**
 * A handle on the core database whose first delete fails: a record's
 * purge that stops before anything is deleted.
 */
function deleteFailsOnce() {
  const db = core();
  const remove = db.delete.bind(db);
  const seen = { deletes: 0 };
  Reflect.set(db, "delete", (...args: Parameters<typeof db.delete>) => {
    seen.deletes += 1;
    if (seen.deletes === 1) throw new Error("D1 unavailable");
    return remove(...args);
  });
  return db;
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
  it("is half a day, in seconds: shorter than the daily firing's interval", () => {
    expect(QUARANTINE_PURGE_LEASE_SECONDS).toBe(43_200);
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

  it("keeps the record when its delete fails, due again once the lease has passed", async () => {
    const now = nowSeconds();
    const record = await quarantined({ retainUntil: now - DAY });

    const purge = await purgeExpiredQuarantine(
      deleteFailsOnce(),
      env.MEDIA,
      now,
    );

    expect(purge).toStrictEqual({
      purged: 0,
      failed: [{ id: record.id, error: new Error("D1 unavailable") }],
    });
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

  it("leaves the copies to the sweep when R2 refuses them after the record has gone", async () => {
    const now = nowSeconds();
    const record = await quarantined({ retainUntil: now - DAY });
    const refusal = new Error("R2 unavailable");
    const failing = {
      delete: vi.fn().mockRejectedValue(refusal),
      list: env.MEDIA.list.bind(env.MEDIA),
    };

    const purge = await purgeExpiredQuarantine(core(), failing, now);

    expect(purge).toStrictEqual({
      purged: 0,
      failed: [{ id: record.id, error: refusal }],
    });
    expect(failing.delete).toHaveBeenCalledWith(record.keys);
    expect(await recordOf(record.id)).toBeUndefined();
    for (const key of record.keys) expect(await isStored(key)).toBe(true);

    await purgeExpiredQuarantine(core(), env.MEDIA, now + 367 * DAY);
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

  it("claims nothing for a purge that read a record before another claimed it", async () => {
    // The compare-and-swap itself: two purges read the same record at the
    // same `retain_until`, and only the first claim may take it.
    const now = nowSeconds();
    const record = await quarantined({ retainUntil: now - DAY });
    const [readByOne, readByOther] = await Promise.all([
      dueQuarantine(core(), now),
      dueQuarantine(core(), now),
    ]);
    expect(readByOne).toStrictEqual([
      { id: record.id, retainUntil: now - DAY },
    ]);
    expect(readByOther).toStrictEqual(readByOne);

    const byOne = await claimQuarantine(core(), readByOne, now);
    const byOther = await claimQuarantine(core(), readByOther, now);

    expect(byOne.map((claimed) => claimed.id)).toStrictEqual([record.id]);
    expect(byOther).toStrictEqual([]);
    expect(await recordOf(record.id)).toMatchObject({
      retainUntil: now + QUARANTINE_PURGE_LEASE_SECONDS,
    });
  });

  it("gives a second purge at the same moment nothing, once the first has moved the record on", async () => {
    const now = nowSeconds();
    const record = await quarantined({ retainUntil: now - DAY });
    const deletes = vi.fn().mockResolvedValue(undefined);

    const first = await purgeExpiredQuarantine(
      deleteFailsOnce(),
      env.MEDIA,
      now,
    );
    const second = await purgeExpiredQuarantine(
      core(),
      { delete: deletes, list: env.MEDIA.list.bind(env.MEDIA) },
      now,
    );

    expect(first.failed.map((failure) => failure.id)).toStrictEqual([
      record.id,
    ]);
    expect(second).toStrictEqual({ purged: 0, failed: [] });
    expect(deletes).not.toHaveBeenCalled();
    expect(await recordOf(record.id)).toBeDefined();
  });

  it("retries a failed record at the next day's firing, however late today's reached it", async () => {
    // Today's firing reached the purge an hour in; tomorrow's reaches it
    // at once. The lease must be over by then, or a failure waits two days.
    const firing = nowSeconds();
    const record = await quarantined({ retainUntil: firing - DAY });
    await purgeExpiredQuarantine(
      deleteFailsOnce(),
      env.MEDIA,
      firing + 60 * 60,
    );

    const tomorrow = await purgeExpiredQuarantine(
      core(),
      env.MEDIA,
      firing + DAY,
    );

    expect(tomorrow).toStrictEqual({ purged: 1, failed: [] });
    expect(await recordOf(record.id)).toBeUndefined();
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

    const purge = await purgeExpiredQuarantine(core(), {
      delete: deletes,
      list: env.MEDIA.list.bind(env.MEDIA),
    });

    expect(purge).toStrictEqual({ purged: 0, failed: [] });
    expect(deletes).not.toHaveBeenCalled();
    expect(await recordOf(kept.id)).toBeDefined();
  });
});

describe("a copy two records list", () => {
  it("stays while the other record lists it, and goes with the last", async () => {
    const now = nowSeconds();
    const first = await quarantined({ retainUntil: now - DAY, photos: 1 });
    const snapshot = JSON.stringify(
      first.keys.map((preservedKey) => ({ preservedKey })),
    );
    const second = await quarantined({
      retainUntil: now + DAY,
      photos: 0,
      snapshot,
    });

    const deletes = vi.spyOn(env.MEDIA, "delete");

    expect(await purgeExpiredQuarantine(core(), env.MEDIA, now)).toStrictEqual({
      purged: 1,
      failed: [],
    });
    expect(await recordOf(first.id)).toBeUndefined();
    for (const key of first.keys) expect(await isStored(key)).toBe(true);
    // Nothing left to delete is not a delete of nothing.
    expect(deletes).not.toHaveBeenCalled();
    deletes.mockRestore();

    await purgeExpiredQuarantine(core(), env.MEDIA, now + 2 * DAY);
    expect(await recordOf(second.id)).toBeUndefined();
    for (const key of first.keys) expect(await isStored(key)).toBe(false);
  });
});

/**
The runbook, read as text.
*/
const runbook: Record<string, string> = import.meta.glob(
  "../../docs/deployment.md",
  { query: "?raw", import: "default", eager: true },
);

describe("QUARANTINE_LOCK_DAYS", () => {
  it("is the retention of the runbook's lock on the quarantine prefix", () => {
    const text = Object.values(runbook).join("");
    const rule =
      /Lock `quarantine\/`[\s\S]*?retention \*\*(\d+) days\*\*/u.exec(text);

    expect(Number(rule?.[1])).toBe(QUARANTINE_LOCK_DAYS);
  });

  it("is what an unlisted copy waits, and a day more", () => {
    expect(QUARANTINE_UNLISTED_GRACE_SECONDS).toBe(
      (QUARANTINE_LOCK_DAYS + 1) * DAY,
    );
  });
});

describe("copies no record lists", () => {
  it("are kept a year and a day after R2 says they were written, then deleted by the purge", async () => {
    const copy = unlisted(newUlid());
    await env.MEDIA.put(copy, "bytes");
    const madeAt = nowSeconds();

    await purgeExpiredQuarantine(core(), env.MEDIA, madeAt + 2 * DAY);
    expect(await isStored(copy)).toBe(true);
    await purgeExpiredQuarantine(core(), env.MEDIA, madeAt + 366 * DAY - 60);
    expect(await isStored(copy)).toBe(true);

    expect(
      await purgeExpiredQuarantine(core(), env.MEDIA, madeAt + 366 * DAY + 60),
    ).toStrictEqual({ purged: 0, failed: [] });
    expect(await isStored(copy)).toBe(false);
  });

  it("deletes a copy written exactly a day before, and lists the first page with no cursor", async () => {
    const now = nowSeconds();
    const onTheLine = unlisted(newUlid());
    const justInside = unlisted(newUlid());
    const media = {
      delete: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue({
        objects: [
          {
            key: onTheLine,
            uploaded: new Date(
              (now - QUARANTINE_UNLISTED_GRACE_SECONDS) * 1000,
            ),
          },
          {
            key: justInside,
            uploaded: new Date(
              (now - QUARANTINE_UNLISTED_GRACE_SECONDS + 1) * 1000,
            ),
          },
        ],
        truncated: false,
      }),
    };

    await purgeExpiredQuarantine(core(), media, now);

    expect(media.list.mock.calls).toStrictEqual([
      [{ prefix: quarantineKeyFor(""), limit: 100 }],
    ]);
    expect(media.delete.mock.calls).toStrictEqual([[[onTheLine]]]);
  });

  it("keeps an old copy a record lists, and deletes nothing outside the prefix", async () => {
    const now = nowSeconds();
    const kept = await quarantined({ retainUntil: now + 400 * DAY });
    const live = entryPhotoKeyFor("u", "e", newUlid());
    await env.MEDIA.put(live, "bytes");

    await purgeExpiredQuarantine(core(), env.MEDIA, now + 367 * DAY);

    for (const key of kept.keys) expect(await isStored(key)).toBe(true);
    expect(await isStored(live)).toBe(true);
    await env.MEDIA.delete(live);
  });

  it("goes through every page of the prefix", async () => {
    const copies = Array.from({ length: 101 }, () => unlisted(newUlid()));
    for (const copy of copies) await env.MEDIA.put(copy, "bytes");

    await purgeExpiredQuarantine(core(), env.MEDIA, nowSeconds() + 367 * DAY);

    expect(await env.MEDIA.list({ prefix: "quarantine/" })).toMatchObject({
      objects: [],
    });
  });

  it("says so, and throws nothing, when the prefix cannot be listed", async () => {
    const refusal = new Error("R2 unavailable");
    const media = {
      delete: vi.fn(),
      list: vi.fn().mockRejectedValue(refusal),
    };

    expect(await purgeExpiredQuarantine(core(), media)).toStrictEqual({
      purged: 0,
      failed: [{ id: "unlisted-copies", error: refusal }],
    });
    expect(media.delete).not.toHaveBeenCalled();
  });

  it(`says so after ${String(QUARANTINE_SWEEP_PAGES)} pages, when more remain`, async () => {
    const media = {
      delete: vi.fn(),
      list: vi
        .fn()
        .mockResolvedValue({ objects: [], truncated: true, cursor: "next" }),
    };

    const purge = await purgeExpiredQuarantine(core(), media);

    expect(media.list).toHaveBeenCalledTimes(QUARANTINE_SWEEP_PAGES);
    expect(media.list).toHaveBeenLastCalledWith({
      prefix: quarantineKeyFor(""),
      limit: 100,
      cursor: "next",
    });
    expect(purge.failed).toStrictEqual([
      {
        id: "unlisted-copies",
        error: new Error(
          `more copies than ${String(QUARANTINE_SWEEP_PAGES)} pages`,
        ),
      },
    ]);
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

/**
A copy's key no record made.
*/
function unlisted(key: string): string {
  return quarantineKeyFor(entryPhotoKeyFor("u", "e", key));
}

describe("copiesNoRecordLists", () => {
  it("names the copies no record lists, in order, and keeps the ones a record does", async () => {
    const first = await quarantined({ retainUntil: nowSeconds() + DAY });
    const second = await quarantined({ retainUntil: nowSeconds() + DAY });
    const [listed, alsoListed] = [first.keys[1], second.keys[0]];
    if (listed === undefined || alsoListed === undefined)
      throw new Error("two records");
    const copies = [unlisted("b"), listed, alsoListed, unlisted("a")];

    expect(await copiesNoRecordLists(copies)).toStrictEqual([
      unlisted("b"),
      unlisted("a"),
    ]);
  });

  it("names every copy with no record at all, and nothing with no copies", async () => {
    expect(await copiesNoRecordLists([unlisted("a")])).toStrictEqual([
      unlisted("a"),
    ]);
    await quarantined({ retainUntil: nowSeconds() + DAY });
    expect(await copiesNoRecordLists([])).toStrictEqual([]);
  });

  it("does not take a key a snapshot holds only inside a longer one as listed", async () => {
    const key = unlisted("a");
    await quarantined({
      retainUntil: nowSeconds() + DAY,
      snapshot: JSON.stringify([{ preservedKey: `${key}/card.webp` }]),
    });

    expect(await copiesNoRecordLists([key])).toStrictEqual([key]);
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
