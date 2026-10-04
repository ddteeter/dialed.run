import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { user } from "../../src/db/schema-auth";
import {
  dataExports,
  entryPhotos,
  imports,
  outbox,
  outfitEntries,
  outfitEntryItems,
  runs,
  userProfiles,
  wardrobeItems,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { EXPORT_LINK_TTL_S } from "../../src/lib/contracts/data-export";
import { newUlid } from "../../src/lib/ids";
import {
  exportKeyFor,
  exportPrefixFor,
  failExport,
  newLinkToken,
} from "../../src/modules/account/data-exports";
import {
  buildExport,
  exportConsumersFromEnv,
  type BuildDeps,
} from "../../src/modules/account/export-build";
import { entryAudienceColumns } from "../feed/helpers";
import { batchOf, fakeMessage } from "../queue-fakes";
import { core } from "../email/helpers";
import { readZip, textOf } from "./zip-reader";

/**
 * The export's queued build (task 126, ACC-10) on real D1 and R2: the ZIP
 * it stages, the row it finishes, the email it owes — and what it does
 * with a job it should not work.
 */

const db = core();
const NOW = 1_800_000_000;

async function seedRunner(): Promise<string> {
  const userId = newUlid();
  await db.insert(user).values({
    id: userId,
    name: "",
    email: `zip-${userId}@example.test`,
    emailVerified: true,
    createdAt: new Date((NOW - 86_400) * 1000),
    updatedAt: new Date((NOW - 86_400) * 1000),
  });
  return userId;
}

/**
One of everything the ZIP copies: a garment photo, an entry photo, a file.
*/
async function seedEverything(userId: string) {
  const garmentId = newUlid();
  const photoKey = `items/${userId}/${garmentId}/01V1`;
  await env.MEDIA.put(`${photoKey}/original.jpg`, "garment original");
  await env.MEDIA.put(`${photoKey}/card.webp`, "garment card");
  await db.insert(wardrobeItems).values({
    id: garmentId,
    userId,
    category: "top",
    name: "Harrier",
    photoKey,
    createdAt: NOW - 500,
  });
  const runId = newUlid();
  await db.insert(runs).values({
    id: runId,
    userId,
    source: "file",
    startedAt: NOW - 3600,
    durationS: 1800,
    distanceM: 5000,
    title: "Parkrun",
  });
  const importId = newUlid();
  const fileKey = `imports/${userId}/${importId}.gpx`;
  await env.IMPORTS.put(fileKey, "<gpx/>");
  await db.insert(imports).values({
    id: importId,
    userId,
    r2Key: fileKey,
    status: "done",
    runId,
    createdAt: NOW - 3000,
  });
  const entryId = newUlid();
  await db.insert(outfitEntries).values({
    id: entryId,
    runId,
    userId,
    verdict: 0,
    ...entryAudienceColumns("runners"),
    createdAt: NOW - 2000,
  });
  await db
    .insert(outfitEntryItems)
    .values({ entryId, itemId: garmentId, note: "just right" });
  const entryPhotoKey = `entries/${userId}/${entryId}/${newUlid()}`;
  await env.MEDIA.put(entryPhotoKey, "entry photo");
  await db.insert(entryPhotos).values({
    id: newUlid(),
    entryId,
    photoKey: entryPhotoKey,
    position: 0,
  });
  await db.insert(userProfiles).values({
    userId,
    username: `z${userId.slice(-10).toLowerCase()}`,
  });
  return { garmentId, runId, importId, entryId };
}

async function seedExport(
  userId: string,
  status: (typeof dataExports.$inferInsert)["status"],
) {
  const id = newUlid();
  const linkToken = newLinkToken();
  await db.insert(dataExports).values({
    id,
    userId,
    idempotencyKey: newUlid(),
    linkToken,
    status,
    requestedAt: NOW - 60,
  });
  return { id, linkToken };
}

function depsWith(overrides: Partial<BuildDeps> = {}) {
  const reports: { error: unknown; context: Record<string, string> }[] = [];
  const settled: string[] = [];
  const deps: BuildDeps = {
    db,
    media: env.MEDIA,
    imports: env.IMPORTS,
    report: (error, context) => {
      reports.push({ error, context });
    },
    settle: (_db, debt) => {
      settled.push(debt.id);
      return Promise.resolve();
    },
    now: NOW,
    ...overrides,
  };
  return { deps, reports, settled };
}

async function rowOf(id: string) {
  const [row] = await db
    .select()
    .from(dataExports)
    .where(eq(dataExports.id, id));
  return row;
}

async function statusOf(id: string) {
  const row = await rowOf(id);
  return row?.status;
}

/**
Every ZIP any build staged for this export, by key.
*/
async function stagedKeys(userId: string, exportId: string) {
  const listed = await env.IMPORTS.list({
    prefix: `${exportPrefixFor(userId)}${exportId}/`,
  });
  return listed.objects.map((object) => object.key);
}

/**
The ZIP the claim holding the row staged, opened.
*/
async function stagedZip(exportId: string) {
  const row = await rowOf(exportId);
  const key = row && exportKeyFor(row);
  if (key === undefined) throw new Error("nothing claimed");
  const staged = await env.IMPORTS.get(key);
  if (staged === null) throw new Error("nothing staged");
  return { staged, zip: readZip(await staged.arrayBuffer()) };
}

/**
 * A media bucket whose first listing waits for `release`: the build that
 * gets it has claimed its row and stops there, so a test can do what
 * another delivery, the DLQ or the purge would do meanwhile.
 */
function pausedMedia() {
  const reached = Promise.withResolvers<undefined>();
  const gate = Promise.withResolvers<undefined>();
  const media: BuildDeps["media"] = {
    get: (key) => env.MEDIA.get(key),
    list: async (options) => {
      reached.resolve(undefined);
      await gate.promise;
      return env.MEDIA.list(options);
    },
  };
  return {
    media,
    reached: reached.promise,
    release: () => {
      gate.resolve(undefined);
    },
  };
}

function silenced() {
  return vi.spyOn(console, "error").mockImplementation(() => {
    /*
    Sentry is disabled in tests; the capture logs instead.
    */
  });
}

function unreported(): void {
  /*
  The DLQ's report is not what these tests read.
  */
}

async function owedFor(exportId: string) {
  return db
    .select({ id: outbox.id, payload: outbox.payload })
    .from(outbox)
    .where(eq(outbox.dedupeKey, `export_ready:${exportId}`));
}

describe("buildExport", () => {
  it("stages the runner's ZIP, marks the export ready for 7 days, and owes the email in one go", async () => {
    const userId = await seedRunner();
    const seeded = await seedEverything(userId);
    const exported = await seedExport(userId, "pending");
    const { deps, reports, settled } = depsWith();

    await buildExport(deps, exported.id);

    const { staged, zip } = await stagedZip(exported.id);
    expect(staged.httpMetadata?.contentType).toBe("application/zip");
    const { files } = zip;
    expect(zip.names).toStrictEqual([
      "README.txt",
      "profile.csv",
      "runs.csv",
      "entries.csv",
      "kit.csv",
      "garments.csv",
      "terms.csv",
      `photos/entries/${seeded.entryId}-1.jpg`,
      `photos/closet/${seeded.garmentId}.jpg`,
      `run-files/${seeded.importId}.gpx`,
    ]);
    expect(textOf(files, `photos/closet/${seeded.garmentId}.jpg`)).toBe(
      "garment original",
    );
    expect(textOf(files, `photos/entries/${seeded.entryId}-1.jpg`)).toBe(
      "entry photo",
    );
    expect(textOf(files, `run-files/${seeded.importId}.gpx`)).toBe("<gpx/>");
    expect(textOf(files, "kit.csv")).toBe(
      `entry_id,garment_id,flag,note\r\n${seeded.entryId},${seeded.garmentId},,just right\r\n`,
    );
    expect(textOf(files, "runs.csv")).toContain(
      `,run-files/${seeded.importId}.gpx\r\n`,
    );

    const row = await rowOf(exported.id);
    expect(row).toMatchObject({
      status: "ready",
      claimedAt: NOW,
      readyAt: NOW,
      expiresAt: NOW + EXPORT_LINK_TTL_S,
    });
    // One ZIP, under the claim the row holds.
    expect(row?.claimId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/u);
    expect(await stagedKeys(userId, exported.id)).toStrictEqual([
      `exports/${userId}/${exported.id}/${String(row?.claimId)}.zip`,
    ]);
    const owed = await owedFor(exported.id);
    expect(owed.map((row): unknown => JSON.parse(row.payload))).toStrictEqual([
      {
        dedupeKey: `export_ready:${exported.id}`,
        email: {
          to: { userId },
          template: { kind: "export_ready", token: exported.linkToken },
        },
      },
    ]);
    // The fast path is handed the debt the batch wrote.
    expect(settled).toStrictEqual(owed.map((row) => row.id));
    expect(reports).toStrictEqual([]);
  });

  it("rebuilds an export a crashed delivery left building", async () => {
    const userId = await seedRunner();
    const exported = await seedExport(userId, "building");
    const { deps } = depsWith();

    await buildExport(deps, exported.id);

    expect(await statusOf(exported.id)).toBe("ready");
    const { zip } = await stagedZip(exported.id);
    // Nothing in the account but the account: the texts, no files.
    expect(zip.names).toHaveLength(7);
  });

  it.each(["ready", "failed", "expiring"] as const)(
    "does nothing for an export already %s",
    async (status) => {
      const userId = await seedRunner();
      const exported = await seedExport(userId, status);
      const { deps, settled } = depsWith();

      await buildExport(deps, exported.id);

      expect(await statusOf(exported.id)).toBe(status);
      expect(await stagedKeys(userId, exported.id)).toStrictEqual([]);
      expect(await owedFor(exported.id)).toStrictEqual([]);
      expect(settled).toStrictEqual([]);
    },
  );

  it("does nothing for an export that is gone", async () => {
    const { deps, settled } = depsWith();
    await buildExport(deps, newUlid());
    expect(settled).toStrictEqual([]);
  });

  it("reports the ids, leaves no ZIP, and throws for the queue to retry when a file vanishes mid-build", async () => {
    const userId = await seedRunner();
    await seedEverything(userId);
    const exported = await seedExport(userId, "pending");
    const { deps, reports, settled } = depsWith({
      media: {
        list: (options) => env.MEDIA.list(options),
        // Gone since the listing: R2's own answer for a missing key.
        get: () => env.MEDIA.get(`missing/${newUlid()}`),
      },
    });

    await expect(buildExport(deps, exported.id)).rejects.toThrow(
      "an export file went missing",
    );

    expect(reports.map((report) => report.context)).toStrictEqual([
      { surface: "account-export-build", exportId: exported.id, userId },
    ]);
    // Still claimed, so the redelivery re-claims it; nothing owed, and
    // the half-made ZIP (zeros where the file was) is gone.
    expect(await statusOf(exported.id)).toBe("building");
    expect(await owedFor(exported.id)).toStrictEqual([]);
    expect(settled).toStrictEqual([]);
    expect(await stagedKeys(userId, exported.id)).toStrictEqual([]);
  });

  it("writes a vanished file larger than one chunk as zeros of its full size, so the upload completes", async () => {
    const userId = await seedRunner();
    const seeded = await seedEverything(userId);
    const big = 200 * 1024;
    const photoKey = `items/${userId}/${seeded.garmentId}/01V1/original.jpg`;
    await env.MEDIA.put(photoKey, new Uint8Array(big));
    const exported = await seedExport(userId, "pending");
    const written: { key: string; bytes: number }[] = [];
    const { deps } = depsWith({
      media: {
        list: (options) => env.MEDIA.list(options),
        get: (key) =>
          // Gone since the listing: R2's own answer for a missing key.
          env.MEDIA.get(key === photoKey ? `missing/${newUlid()}` : key),
      },
      imports: {
        list: (options) => env.IMPORTS.list(options),
        get: (key) => env.IMPORTS.get(key),
        delete: (keys) => env.IMPORTS.delete(keys),
        put: async (key, value, options) => {
          const stored = await env.IMPORTS.put(key, value, options);
          written.push({ key, bytes: stored.size });
          return stored;
        },
      },
    });

    await expect(buildExport(deps, exported.id)).rejects.toThrow(
      "an export file went missing",
    );

    // The upload reached its promised length, which it cannot short of a
    // zero for every byte of the missing photo.
    expect(written).toHaveLength(1);
    expect(written[0]?.bytes).toBeGreaterThan(big);
    expect(await stagedKeys(userId, exported.id)).toStrictEqual([]);
  });

  it("throws the underlying error, not the missing-file message, when the write itself fails", async () => {
    // The `isMissing` flag must start false and only flip when R2 answers
    // null for a listed key — never fire for an unrelated failure such as
    // the upload write itself rejecting.
    const userId = await seedRunner();
    await seedEverything(userId);
    const exported = await seedExport(userId, "pending");
    const failure = new Error("boom: imports.put rejected");
    const { deps } = depsWith({
      imports: {
        list: (options) => env.IMPORTS.list(options),
        get: (key) => env.IMPORTS.get(key),
        delete: (keys) => env.IMPORTS.delete(keys),
        put: () => Promise.reject(failure),
      },
    });

    await expect(buildExport(deps, exported.id)).rejects.toThrow(
      "boom: imports.put rejected",
    );
  });

  it("stamps every ZIP entry with the build's own clock, not a raw reinterpretation of it", async () => {
    const userId = await seedRunner();
    await seedEverything(userId);
    const exported = await seedExport(userId, "pending");
    const { deps } = depsWith();

    await buildExport(deps, exported.id);

    const { zip } = await stagedZip(exported.id);
    const stamped = zip.modified.get("README.txt");
    // NOW is 1_800_000_000 seconds — 2027. `deps.now / 1000` would land
    // within seconds of the epoch, which DOS's date field cannot even
    // represent as 2027, so any year this far off kills the mutant.
    expect(stamped?.getFullYear()).toBe(new Date(NOW * 1000).getFullYear());
  });

  it("lists only the runner's own prefixes, never the whole bucket", async () => {
    const userId = await seedRunner();
    const exported = await seedExport(userId, "pending");
    const listed: (string | undefined)[] = [];
    const { deps } = depsWith({
      media: {
        get: (key) => env.MEDIA.get(key),
        list: (options) => {
          listed.push(options?.prefix);
          return env.MEDIA.list(options);
        },
      },
      imports: {
        get: (key) => env.IMPORTS.get(key),
        put: (key, value, options) => env.IMPORTS.put(key, value, options),
        delete: (keys) => env.IMPORTS.delete(keys),
        list: (options) => {
          listed.push(options?.prefix);
          return env.IMPORTS.list(options);
        },
      },
    });

    await buildExport(deps, exported.id);

    expect(listed).toStrictEqual([
      `entries/${userId}/`,
      `items/${userId}/`,
      `imports/${userId}/`,
    ]);
  });

  it("finds every garment photo past one listing page", async () => {
    const userId = await seedRunner();
    const seeded = await seedEverything(userId);
    const exported = await seedExport(userId, "pending");
    const pages: (string | undefined)[] = [];
    const { deps } = depsWith({
      media: {
        get: (key) => env.MEDIA.get(key),
        // One object a page, so the garment's original is past the first.
        list: (options) => {
          pages.push(options?.cursor);
          return env.MEDIA.list({ ...options, limit: 1 });
        },
      },
    });

    await buildExport(deps, exported.id);

    const { zip } = await stagedZip(exported.id);
    expect(zip.names).toContain(`photos/closet/${seeded.garmentId}.jpg`);
    expect(pages.length).toBeGreaterThan(2);
  });
});

describe("two builds of one export", () => {
  it("send one email and leave one ZIP when a second delivery overtakes the first", async () => {
    const userId = await seedRunner();
    const exported = await seedExport(userId, "pending");
    const paused = pausedMedia();
    const first = depsWith({ media: paused.media });
    const second = depsWith();

    const overtaken = buildExport(first.deps, exported.id);
    await paused.reached;
    // A sweep re-send or a duplicate delivery, while the first still runs.
    await buildExport(second.deps, exported.id);
    paused.release();
    await overtaken;

    expect(await statusOf(exported.id)).toBe("ready");
    const owed = await owedFor(exported.id);
    expect(owed).toHaveLength(1);
    // The one debt is the winner's, and only the winner settled.
    expect(second.settled).toStrictEqual(owed.map((row) => row.id));
    expect(first.settled).toStrictEqual([]);
    const row = await rowOf(exported.id);
    expect(await stagedKeys(userId, exported.id)).toStrictEqual([
      exportKeyFor({ userId, id: exported.id, claimId: String(row?.claimId) }),
    ]);
  });

  it("send one email and leave one ZIP when they race", async () => {
    const userId = await seedRunner();
    await seedEverything(userId);
    const exported = await seedExport(userId, "pending");
    const one = depsWith();
    const two = depsWith();

    await Promise.all([
      buildExport(one.deps, exported.id),
      buildExport(two.deps, exported.id),
    ]);

    expect(await statusOf(exported.id)).toBe("ready");
    expect(await owedFor(exported.id)).toHaveLength(1);
    expect([...one.settled, ...two.settled]).toHaveLength(1);
    expect(await stagedKeys(userId, exported.id)).toHaveLength(1);
  });
});

describe("an export that stops being this build's mid-build", () => {
  it("owes no email and leaves no ZIP when the runner's purge takes the row", async () => {
    const userId = await seedRunner();
    const exported = await seedExport(userId, "pending");
    const paused = pausedMedia();
    const { deps, settled } = depsWith({ media: paused.media });

    const build = buildExport(deps, exported.id);
    await paused.reached;
    await db.delete(dataExports).where(eq(dataExports.id, exported.id));
    paused.release();
    await build;

    expect(await rowOf(exported.id)).toBeUndefined();
    expect(await owedFor(exported.id)).toStrictEqual([]);
    expect(settled).toStrictEqual([]);
    expect(await stagedKeys(userId, exported.id)).toStrictEqual([]);
  });

  it("owes no email and leaves no ZIP when the DLQ has failed it", async () => {
    const userId = await seedRunner();
    const exported = await seedExport(userId, "pending");
    const paused = pausedMedia();
    const { deps, settled } = depsWith({ media: paused.media });

    const build = buildExport(deps, exported.id);
    await paused.reached;
    await failExport(db, exported.id, unreported);
    paused.release();
    await build;

    expect(await statusOf(exported.id)).toBe("failed");
    expect(await owedFor(exported.id)).toStrictEqual([]);
    expect(settled).toStrictEqual([]);
    expect(await stagedKeys(userId, exported.id)).toStrictEqual([]);
  });
});

describe("exportConsumersFromEnv", () => {
  it("builds on the live bindings", async () => {
    const userId = await seedRunner();
    const exported = await seedExport(userId, "pending");
    const error = silenced();
    const message = fakeMessage("m1", {
      type: "account_export",
      exportId: exported.id,
    });

    await exportConsumersFromEnv().batch(batchOf("dialed-exports", [message]));

    expect(message.ack).toHaveBeenCalled();
    expect(await statusOf(exported.id)).toBe("ready");
    expect(await stagedKeys(userId, exported.id)).toHaveLength(1);
    error.mockRestore();
  });

  it("settles the ready email through the real outbox, not a no-op", async () => {
    const userId = await seedRunner();
    const exported = await seedExport(userId, "pending");
    const error = silenced();

    await exportConsumersFromEnv().batch(
      batchOf("dialed-exports", [
        fakeMessage("m2", { type: "account_export", exportId: exported.id }),
      ]),
    );

    const owed = await owedFor(exported.id);
    // A stubbed `settle` never touches the outbox at all, so either
    // outcome — the real fast path settled the row, or it tried and
    // reported why it could not — is proof it actually ran.
    expect(owed.length === 0 || error.mock.calls.length > 0).toBe(true);
    error.mockRestore();
  });

  it("marks a dead-lettered export failed and tells Sentry its ids", async () => {
    const userId = await seedRunner();
    const exported = await seedExport(userId, "building");
    const error = silenced();

    await exportConsumersFromEnv().deadLetters(
      batchOf("dialed-exports-dlq", [
        fakeMessage("m3", { type: "account_export", exportId: exported.id }),
      ]),
    );

    expect(await statusOf(exported.id)).toBe("failed");
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("sentry-disabled"),
      expect.objectContaining({ exportId: exported.id, userId }),
      expect.objectContaining({ message: "account export dead-lettered" }),
    );
    error.mockRestore();
  });

  it("acks and reports, on the live reporter, a body that is not an export job", async () => {
    const error = silenced();
    const message = fakeMessage("m4", {
      type: "account_export",
      exportId: "not-a-row",
    });
    const broken = { ...message, body: { type: "account_export" } };

    await exportConsumersFromEnv().batch(batchOf("dialed-exports", [broken]));

    expect(broken.ack).toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("sentry-disabled"),
      expect.objectContaining({ queue: "dialed-exports", messageId: "m4" }),
      expect.objectContaining({ message: "invalid exports queue message" }),
    );
    error.mockRestore();
  });
});
