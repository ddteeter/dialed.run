import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { user } from "../../src/db/schema-auth";
import {
  entryPhotos,
  moderationActions,
  notifications,
  outbox,
  outfitEntries,
  products,
  quarantinedContent,
  reports,
  reviewQueue,
  runs,
  userProfiles,
  usernameHistory,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import {
  entryPhotoKeyFor,
  quarantineKeyFor,
} from "../../src/lib/entry-photo-key";
import { newUlid, type Ulid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import {
  decideReview,
  moderateContent,
} from "../../src/modules/feed/moderation";
import {
  photoResponse,
  reviewerPhotoResponse,
} from "../../src/modules/feed/photos";
import {
  accountCount,
  ACCOUNTS_PAGE,
  claimUsername,
  forceRename,
  listAccounts,
  prefixPattern,
} from "../../src/modules/account";
import {
  AdminRequiredError,
  banUser,
  deskRunners,
  placeholderHandle,
  QUARANTINE_PAGE,
  QUARANTINE_RETENTION_SECONDS,
  quarantinedContentFor,
  removalReasons,
  removalReasonSchema,
  removalSentence,
  removalStatements,
  renameReasonSchema,
  renameRecord,
  runnersFilterInput,
  runnersWhere,
  takedownInput,
  unbanUser,
  unbanUserInput,
} from "../../src/modules/safety";

import { makeEntry, makeRun, makeUser, resetSafetyTables } from "./helpers";

/**
 * SAF-5, SAF-6 and SAF-8: what the Desk does to content, and what it
 * leaves behind — rows, objects, the audit and the author's notice.
 */

function core() {
  return drizzle(env.DIALED_CORE);
}

function quiet(): void {
  // Sentry reports are expected on no path here; the fast path is live.
}

async function stored(prefix: string): Promise<string[]> {
  const listed = await env.MEDIA.list({ prefix });
  return listed.objects.map((object) => object.key);
}

/**
R2 outlives a test; the prefixes these tests read start empty.
*/
async function freshState(): Promise<void> {
  await resetSafetyTables();
  for (const prefix of ["entries/", "quarantine/"]) {
    const keys = await stored(prefix);
    if (keys.length > 0) await env.MEDIA.delete(keys);
  }
}

async function postedPhoto() {
  const author = await makeUser();
  // A real account, so an owed email has someone to go to.
  await core()
    .insert(user)
    .values({
      id: author,
      name: author,
      email: `${author.toLowerCase()}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  const runId = await makeRun({ userId: author });
  const entryId = await makeEntry({ userId: author, runId, isPublic: true });
  const photoId = newUlid();
  const key = entryPhotoKeyFor(author, entryId, photoId);
  await env.MEDIA.put(key, new Uint8Array([1, 2, 3]), {
    httpMetadata: { contentType: "image/jpeg" },
  });
  await core().insert(entryPhotos).values({
    id: photoId,
    entryId,
    photoKey: key,
    position: 0,
    screenStatus: "pass",
  });
  return { author, entryId, photoId, key };
}

async function auditFor(subjectId: string) {
  return core()
    .select()
    .from(moderationActions)
    .where(eq(moderationActions.subjectId, subjectId));
}

async function noticesFor(userId: string) {
  return core()
    .select({
      kind: notifications.kind,
      subjectId: notifications.subjectId,
      body: notifications.body,
    })
    .from(notifications)
    .where(eq(notifications.userId, userId));
}

async function queued(
  subjectType: "entry" | "photo" | "product" | "profile",
  subjectId: string,
): Promise<Ulid> {
  const id = newUlid();
  await core().insert(reviewQueue).values({
    id,
    subjectType,
    subjectId,
    source: "reports",
    status: "reviewing",
    createdAt: nowSeconds(),
  });
  return id;
}

async function queueStatus(id: string) {
  const [row] = await core()
    .select({ status: reviewQueue.status, resolvedBy: reviewQueue.resolvedBy })
    .from(reviewQueue)
    .where(eq(reviewQueue.id, id));
  return row;
}

async function profileOf(userId: string) {
  const [row] = await core()
    .select({
      username: userProfiles.username,
      reason: userProfiles.usernameResetReason,
    })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId));
  return row;
}

async function account(
  email: string,
  username: string,
  joined: number,
): Promise<string> {
  const userId = await makeUser({ username });
  await core()
    .insert(user)
    .values({
      id: userId,
      name: username,
      email,
      emailVerified: true,
      createdAt: new Date(joined * 1000),
      updatedAt: new Date(joined * 1000),
    });
  return userId;
}

/**
The Desk's list, wired as its server function wires it.
*/
async function deskList(filter: {
  query?: string | undefined;
  filter: "all" | "reported" | "closed";
}) {
  const accounts = await listAccounts(core(), {
    query: filter.query,
    only: runnersWhere(filter.filter),
  });
  return deskRunners(core(), accounts);
}

async function idsFor(filter: {
  query?: string | undefined;
  filter: "all" | "reported" | "closed";
}): Promise<string[]> {
  const listed = await deskList(filter);
  return listed.map((runner) => runner.userId);
}

/**
 * The email owed, as the outbox holds it. The sender is made to fail so
 * the fast path leaves the row to read (it would otherwise send and
 * delete it).
 */
async function owedEmails() {
  const rows = await core()
    .select({ dedupeKey: outbox.dedupeKey, payload: outbox.payload })
    .from(outbox)
    .where(eq(outbox.kind, "email"));
  return rows.map((row) => {
    const payload: unknown = JSON.parse(row.payload);
    return { dedupeKey: row.dedupeKey, payload };
  });
}

/**
Runs `body` as the one admin.
*/
async function asAdmin<T>(admin: string, body: () => Promise<T>): Promise<T> {
  const admins: unknown = env.ADMIN_USER_IDS;
  Reflect.set(env, "ADMIN_USER_IDS", admin);
  try {
    return await body();
  } finally {
    Reflect.set(env, "ADMIN_USER_IDS", admins);
  }
}

describe("the removal reasons (SAF-8's statement of reasons)", () => {
  it("reads each reason's sentence from the one list", () => {
    expect(removalReasons).toStrictEqual(Object.keys(removalStatements));
    expect(removalReasons[0]).toBe("home");
    expect(removalStatements.home).toBe("it shows where someone lives");
  });

  it("says why a missing reason is refused", () => {
    const refused = removalReasonSchema.safeParse("nope");
    expect(refused.error?.issues[0]?.message).toBe(
      "Pick why it's coming down.",
    );
    const rename = renameReasonSchema.safeParse("");
    expect(rename.error?.issues[0]?.message).toBe(
      "Pick why the name has to go.",
    );
  });

  it("writes the author's sentence for a photo and for an entry", () => {
    expect(removalSentence("photo", "home")).toBe(
      "A moderator removed this photo: it shows where someone lives.",
    );
    expect(removalSentence("entry", "spam")).toBe(
      "A moderator removed this entry from the feed: it's an ad or spam.",
    );
  });
});

describe("moderateContent: Remove deletes (SAF-5)", () => {
  beforeEach(freshState);
  beforeEach(() => {
    vi.spyOn(env.EMAIL, "send").mockRejectedValue(new Error("sender down"));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("deletes a photo's row and object, and records who, what and why", async () => {
    const { author, entryId, photoId, key } = await postedPhoto();
    const moderator = await makeUser();

    const outcome = await moderateContent(
      core(),
      {
        actorId: moderator,
        action: "remove",
        subjectType: "photo",
        subjectId: photoId,
        reason: "home",
      },
      quiet,
    );

    expect(outcome).toBe("removed");
    expect(
      await core()
        .select()
        .from(entryPhotos)
        .where(eq(entryPhotos.id, photoId)),
    ).toStrictEqual([]);
    expect(await stored(key)).toStrictEqual([]);
    // The entry itself stays — "Your run and verdict stay."
    expect(
      await core()
        .select({ id: outfitEntries.id })
        .from(outfitEntries)
        .where(eq(outfitEntries.id, entryId)),
    ).toHaveLength(1);
    const [audit] = await auditFor(photoId);
    expect(audit).toMatchObject({
      actorId: moderator,
      action: "remove",
      subjectType: "photo",
      subjectOwnerId: author,
      reason: "it shows where someone lives",
    });
    expect(audit?.preservedKey ?? undefined).toBeUndefined();
    expect(await noticesFor(author)).toStrictEqual([
      {
        kind: "content_removed",
        subjectId: photoId,
        body: "A moderator removed this photo: it shows where someone lives.",
      },
    ]);
    // The email is owed in the same batch (round 27 #15, `modules/email`).
    expect(await owedEmails()).toStrictEqual([
      {
        dedupeKey: `content_removed:photo:${photoId}`,
        payload: {
          dedupeKey: `content_removed:photo:${photoId}`,
          email: {
            to: { userId: author },
            template: {
              kind: "content_removed",
              subject: "photo",
              reason: "it shows where someone lives",
            },
          },
        },
      },
    ]);
  });

  it("deletes a whole entry with its photos, and settles its open review as the moderator", async () => {
    const { author, entryId, key } = await postedPhoto();
    const moderator = await makeUser();
    const queueId = await queued("entry", entryId);

    await moderateContent(
      core(),
      {
        actorId: moderator,
        action: "remove",
        subjectType: "entry",
        subjectId: entryId,
        reason: "spam",
      },
      quiet,
    );

    expect(
      await core()
        .select()
        .from(outfitEntries)
        .where(eq(outfitEntries.id, entryId)),
    ).toStrictEqual([]);
    expect(await stored(key)).toStrictEqual([]);
    expect(await queueStatus(queueId)).toStrictEqual({
      status: "removed",
      resolvedBy: moderator,
    });
    const [audit] = await auditFor(entryId);
    expect(audit?.subjectOwnerId).toBe(author);
    const [notice] = await noticesFor(author);
    expect(notice?.body).toBe(
      "A moderator removed this entry from the feed: it's an ad or spam.",
    );
  });

  it("answers not found for a subject that is not there, and writes nothing", async () => {
    const missing = newUlid();
    const outcome = await moderateContent(
      core(),
      {
        actorId: "m",
        action: "remove",
        subjectType: "entry",
        subjectId: missing,
        reason: "rules",
      },
      quiet,
    );
    expect(outcome).toBe("not_found");
    expect(await auditFor(missing)).toStrictEqual([]);
    const photo = await moderateContent(
      core(),
      {
        actorId: "m",
        action: "remove",
        subjectType: "photo",
        subjectId: missing,
        reason: "rules",
      },
      quiet,
    );
    expect(photo).toBe("not_found");
  });

  it("answers a repeat as already removed, and writes nothing more", async () => {
    const { author, photoId } = await postedPhoto();
    const takedown = {
      actorId: "desk",
      action: "takedown",
      subjectType: "photo",
      subjectId: photoId,
      reason: "copyright",
      notice: "Acme, ref 1",
    } as const;

    expect(await moderateContent(core(), takedown, quiet)).toBe("removed");
    expect(await moderateContent(core(), takedown, quiet)).toBe(
      "already_removed",
    );

    expect(await auditFor(photoId)).toHaveLength(1);
    expect(await noticesFor(author)).toHaveLength(1);
    expect(await owedEmails()).toHaveLength(1);
  });
});

describe("quarantine: silent, preserved, admin-only (SAF-5, D-70)", () => {
  beforeEach(freshState);

  it("tells the uploader nothing: no bell row, no email", async () => {
    const { author, photoId } = await postedPhoto();

    await moderateContent(
      core(),
      {
        actorId: "moderator",
        action: "quarantine",
        subjectType: "photo",
        subjectId: photoId,
        reason: "explicit",
      },
      quiet,
    );

    expect(await noticesFor(author)).toStrictEqual([]);
    expect(await owedEmails()).toStrictEqual([]);
  });

  it("hides the rows from every read and keeps them, with the uploader, for a year", async () => {
    const { author, entryId, photoId, key } = await postedPhoto();
    const [entryRow] = await core()
      .select()
      .from(outfitEntries)
      .where(eq(outfitEntries.id, entryId));
    const before = nowSeconds();

    await moderateContent(
      core(),
      {
        actorId: "moderator",
        action: "quarantine",
        subjectType: "entry",
        subjectId: entryId,
        reason: "explicit",
      },
      quiet,
    );

    // Hidden: the rows every read touches are gone.
    expect(
      await core()
        .select()
        .from(outfitEntries)
        .where(eq(outfitEntries.id, entryId)),
    ).toStrictEqual([]);
    expect(
      await core()
        .select()
        .from(entryPhotos)
        .where(eq(entryPhotos.entryId, entryId)),
    ).toStrictEqual([]);
    // Preserved: as they stood, beside the audit row that did it.
    const [kept] = await core().select().from(quarantinedContent);
    const [audit] = await auditFor(entryId);
    expect(kept).toMatchObject({
      moderationActionId: audit?.id,
      subjectType: "entry",
      subjectId: entryId,
      uploaderId: author,
      entryId,
    });
    expect(kept?.quarantinedAt).toBeGreaterThanOrEqual(before);
    expect(kept?.retainUntil).toBe(
      (kept?.quarantinedAt ?? 0) + QUARANTINE_RETENTION_SECONDS,
    );
    expect(QUARANTINE_RETENTION_SECONDS).toBe(31_536_000);
    expect(JSON.parse(kept?.entrySnapshot ?? "")).toStrictEqual({
      entry: [entryRow],
      items: [],
      tags: [],
    });
    const [photo] = z
      .array(
        z.object({
          id: z.string(),
          photoKey: z.string(),
          preservedKey: z.string(),
          uploadedAt: z.number(),
          screenStatus: z.string(),
        }),
      )
      .parse(JSON.parse(kept?.photosSnapshot ?? ""));
    expect(photo).toMatchObject({
      id: photoId,
      photoKey: key,
      preservedKey: quarantineKeyFor(key),
      screenStatus: "pass",
    });
    expect(photo?.uploadedAt).toBeGreaterThanOrEqual(before - 60);
    expect(photo?.uploadedAt).toBeLessThanOrEqual(nowSeconds() + 60);
  });

  it("keeps only the photo in scope, and says when a copy had no bytes", async () => {
    const { entryId, photoId, key } = await postedPhoto();
    const otherId = newUlid();
    await core()
      .insert(entryPhotos)
      .values({
        id: otherId,
        entryId,
        photoKey: `${key}-other`,
        position: 1,
        screenStatus: "pass",
      });
    await env.MEDIA.delete(key);

    await moderateContent(
      core(),
      {
        actorId: "moderator",
        action: "quarantine",
        subjectType: "photo",
        subjectId: photoId,
        reason: "explicit",
      },
      quiet,
    );

    const [kept] = await core().select().from(quarantinedContent);
    const photos = z
      .array(z.looseObject({ id: z.string(), photoKey: z.string() }))
      .parse(JSON.parse(kept?.photosSnapshot ?? ""));
    expect(photos).toMatchObject([{ id: photoId, photoKey: key }]);
    expect(photos[0]).not.toHaveProperty("preservedKey");
    expect(photos[0]).not.toHaveProperty("uploadedAt");
  });

  it("is an admin's alone: the record, and the bytes", async () => {
    const { author, photoId, key } = await postedPhoto();
    const admin = await makeUser();
    await moderateContent(
      core(),
      {
        actorId: admin,
        action: "quarantine",
        subjectType: "photo",
        subjectId: photoId,
        reason: "explicit",
      },
      quiet,
    );

    await expect(quarantinedContentFor(core(), author)).rejects.toThrow(
      AdminRequiredError,
    );
    const refused = await reviewerPhotoResponse(quarantineKeyFor(key), author);
    expect(refused.status).toBe(404);
    const viaRoute = await photoResponse(quarantineKeyFor(key), author);
    expect(viaRoute.status).toBe(404);
    const original = await photoResponse(key, author);
    expect(original.status).toBe(404);

    await asAdmin(admin, async () => {
      const records = await quarantinedContentFor(core(), admin);
      expect(records.map((record) => record.subjectId)).toStrictEqual([
        photoId,
      ]);
      const served = await reviewerPhotoResponse(quarantineKeyFor(key), admin);
      expect(served.status).toBe(200);
    });
  });

  it("reads the newest first, a page at a time", async () => {
    const admin = await makeUser();
    const rows = Array.from({ length: QUARANTINE_PAGE + 1 }, (_, index) => ({
      id: newUlid(),
      moderationActionId: newUlid(),
      subjectType: "photo" as const,
      subjectId: `p${String(index)}`,
      uploaderId: "u",
      entryId: "e",
      entrySnapshot: "{}",
      photosSnapshot: "[]",
      quarantinedAt: index,
      retainUntil: index,
    }));
    for (const row of rows) await core().insert(quarantinedContent).values(row);

    const records = await asAdmin(admin, () =>
      quarantinedContentFor(core(), admin),
    );
    expect(records).toHaveLength(QUARANTINE_PAGE);
    expect(records[0]?.subjectId).toBe(`p${String(QUARANTINE_PAGE)}`);
    expect(QUARANTINE_PAGE).toBe(100);
  });

  it("keeps one object under the quarantine prefix, and nothing under entries/", async () => {
    const { author, entryId, photoId, key } = await postedPhoto();

    await moderateContent(
      core(),
      {
        actorId: "moderator",
        action: "quarantine",
        subjectType: "photo",
        subjectId: photoId,
        reason: "explicit",
      },
      quiet,
    );

    expect(await stored(`entries/${author}/${entryId}/`)).toStrictEqual([]);
    expect(await stored("quarantine/")).toStrictEqual([quarantineKeyFor(key)]);
    const kept = await env.MEDIA.get(quarantineKeyFor(key));
    expect(kept?.httpMetadata?.contentType).toBe("image/jpeg");
    const [audit] = await auditFor(photoId);
    expect(audit?.action).toBe("quarantine");
    expect(audit?.preservedKey).toBe(quarantineKeyFor(key));
    // Unreachable: the photo route serves rows, and there is none.
    const viaRoute = await photoResponse(quarantineKeyFor(key), author);
    expect(viaRoute.status).toBe(404);
  });

  it("names the entry's quarantine prefix when a whole entry goes", async () => {
    const { author, entryId, key } = await postedPhoto();

    await moderateContent(
      core(),
      {
        actorId: "moderator",
        action: "quarantine",
        subjectType: "entry",
        subjectId: entryId,
        reason: "explicit",
      },
      quiet,
    );

    expect(await stored("quarantine/")).toStrictEqual([quarantineKeyFor(key)]);
    const [audit] = await auditFor(entryId);
    expect(audit?.preservedKey).toBe(
      quarantineKeyFor(`entries/${author}/${entryId}/`),
    );
  });

  it("asks R2 for nothing when a whole entry has no photos", async () => {
    const author = await makeUser();
    const runId = await makeRun({ userId: author });
    const entryId = await makeEntry({ userId: author, runId, isPublic: true });
    const media = env.MEDIA;
    const asked: string[] = [];
    Reflect.set(
      env,
      "MEDIA",
      new Proxy(media, {
        get(target, property): unknown {
          return property === "get"
            ? (key: string) => {
                asked.push(key);
                return target.get(key);
              }
            : Reflect.get(target, property, target);
        },
      }),
    );
    try {
      await moderateContent(
        core(),
        {
          actorId: "moderator",
          action: "quarantine",
          subjectType: "entry",
          subjectId: entryId,
          reason: "explicit",
        },
        quiet,
      );
    } finally {
      Reflect.set(env, "MEDIA", media);
    }
    expect(asked).toStrictEqual([]);
  });

  it("skips a photo whose object is already gone", async () => {
    const { photoId, key } = await postedPhoto();
    await env.MEDIA.delete(key);

    const outcome = await moderateContent(
      core(),
      {
        actorId: "moderator",
        action: "quarantine",
        subjectType: "photo",
        subjectId: photoId,
        reason: "explicit",
      },
      quiet,
    );

    expect(outcome).toBe("removed");
    expect(await stored("quarantine/")).toStrictEqual([]);
  });
});

describe("takedown (SAF-6)", () => {
  beforeEach(freshState);

  it("deletes the object and records the notice it answers", async () => {
    const { photoId, key } = await postedPhoto();

    await moderateContent(
      core(),
      {
        actorId: "desk",
        action: "takedown",
        subjectType: "photo",
        subjectId: photoId,
        reason: "copyright",
        notice: "Acme Photo Co, ref 2026-114",
      },
      quiet,
    );

    expect(await stored(key)).toStrictEqual([]);
    const [audit] = await auditFor(photoId);
    expect(audit).toMatchObject({
      actorId: "desk",
      action: "takedown",
      reason: "it uses someone else's work — Acme Photo Co, ref 2026-114",
    });
  });

  it("parses the Desk's form, with the schema's own sentences", () => {
    expect(
      takedownInput.safeParse({
        subjectType: "photo",
        subjectId: newUlid(),
        notice: "  ",
      }).error?.issues[0]?.message,
    ).toBe("Say who sent the notice and its reference.");
    expect(
      takedownInput.safeParse({
        subjectType: "run",
        subjectId: newUlid(),
        notice: "x",
      }).error?.issues[0]?.message,
    ).toBe("Pick a photo or an entry.");
    expect(
      takedownInput.safeParse({
        subjectType: "entry",
        subjectId: newUlid(),
        notice: "x".repeat(501),
      }).error?.issues[0]?.message,
    ).toBe("Keep it under 500 characters.");
  });
});

describe("decideReview: the queue's Remove really deletes", () => {
  beforeEach(freshState);

  it("approves through safety's own path", async () => {
    const { entryId } = await postedPhoto();
    const queueId = await queued("entry", entryId);

    const outcome = await decideReview(core(), "rev", {
      queueId: queueId,
      action: "approve",
    });

    expect(outcome).toBe("resolved");
    expect(await queueStatus(queueId)).toStrictEqual({
      status: "approved",
      resolvedBy: "rev",
    });
  });

  it("removes a reported photo for real, and quarantines on request", async () => {
    const first = await postedPhoto();
    const second = await postedPhoto();
    const removalRow = await queued("photo", first.photoId);
    const quarantineId = await queued("photo", second.photoId);

    expect(
      await decideReview(core(), "rev", {
        queueId: removalRow,
        action: "remove",
        reason: "home",
      }),
    ).toBe("resolved");
    expect(
      await decideReview(core(), "rev", {
        queueId: quarantineId,
        action: "quarantine",
        reason: "explicit",
      }),
    ).toBe("resolved");

    expect(await stored("entries/")).toStrictEqual([]);
    expect(await stored("quarantine/")).toStrictEqual([
      quarantineKeyFor(second.key),
    ]);
    expect(
      await core()
        .select()
        .from(entryPhotos)
        .where(eq(entryPhotos.id, first.photoId)),
    ).toStrictEqual([]);
    expect(await queueStatus(removalRow)).toStrictEqual({
      status: "removed",
      resolvedBy: "rev",
    });
  });

  it("hides a product the old way, and settles a row whose subject is gone", async () => {
    const productId = newUlid();
    const productRow = await queued("product", productId);
    const goneRow = await queued("entry", newUlid());

    expect(
      await decideReview(core(), "rev", {
        queueId: productRow,
        action: "remove",
        reason: "rules",
      }),
    ).toBe("resolved");
    expect(
      await decideReview(core(), "rev", {
        queueId: goneRow,
        action: "remove",
        reason: "rules",
      }),
    ).toBe("resolved");
    const settled = await queueStatus(goneRow);
    expect(settled?.status).toBe("removed");
    expect(await queueStatus(productRow)).toStrictEqual({
      status: "removed",
      resolvedBy: "rev",
    });
    expect(
      await core().select().from(products).where(eq(products.id, productId)),
    ).toStrictEqual([]);
  });

  it("takes down a row nobody has claimed yet", async () => {
    const { entryId } = await postedPhoto();
    const queueId = newUlid();
    await core().insert(reviewQueue).values({
      id: queueId,
      subjectType: "entry",
      subjectId: entryId,
      source: "reports",
      status: "pending",
      createdAt: nowSeconds(),
    });

    await decideReview(core(), "rev", {
      queueId,
      action: "remove",
      reason: "rules",
    });

    expect(
      await core()
        .select({ id: outfitEntries.id })
        .from(outfitEntries)
        .where(eq(outfitEntries.id, entryId)),
    ).toStrictEqual([]);
  });

  it("never takes down what a reviewer already approved", async () => {
    const { entryId } = await postedPhoto();
    const queueId = await queued("entry", entryId);
    await decideReview(core(), "rev", { queueId, action: "approve" });

    expect(
      await decideReview(core(), "rev", {
        queueId,
        action: "remove",
        reason: "rules",
      }),
    ).toBe("already_resolved");
    expect(
      await core()
        .select({ id: outfitEntries.id })
        .from(outfitEntries)
        .where(eq(outfitEntries.id, entryId)),
    ).toHaveLength(1);
  });

  it("says what a stale tab needs to hear", async () => {
    const { entryId } = await postedPhoto();
    const queueId = await queued("entry", entryId);
    await decideReview(core(), "rev", {
      queueId: queueId,
      action: "remove",
      reason: "rules",
    });

    expect(
      await core()
        .select()
        .from(outfitEntries)
        .where(eq(outfitEntries.id, entryId)),
    ).toStrictEqual([]);
    expect(
      await decideReview(core(), "rev", {
        queueId: queueId,
        action: "remove",
        reason: "rules",
      }),
    ).toBe("already_resolved");
    expect(
      await decideReview(core(), "rev", {
        queueId: newUlid(),
        action: "quarantine",
        reason: "rules",
      }),
    ).toBe("not_found");
  });
});

describe("bans are audited", () => {
  beforeEach(freshState);

  it("records the ban with its reason, and the lift beside it", async () => {
    const runner = await makeUser();

    await banUser({ userId: runner, reason: "Spam accounts", bannedBy: "op" });
    await unbanUser(runner, "op2");

    const audit = await auditFor(runner);
    expect(
      audit.map(({ action, actorId, reason, subjectType, subjectOwnerId }) => ({
        action,
        actorId,
        reason,
        subjectType,
        subjectOwnerId,
      })),
    ).toStrictEqual([
      {
        action: "ban",
        actorId: "op",
        reason: "Spam accounts",
        subjectType: "profile",
        subjectOwnerId: runner,
      },
      {
        action: "unban",
        actorId: "op2",
        reason: "Reopened from the Desk",
        subjectType: "profile",
        subjectOwnerId: runner,
      },
    ]);
  });
});

describe("unbanUserInput", () => {
  it("takes a user id", () => {
    expect(unbanUserInput.parse({ userId: "u-1" })).toEqual({
      userId: "u-1",
    });
  });

  it("refuses an empty one", () => {
    expect(unbanUserInput.safeParse({ userId: "" }).success).toBe(false);
  });

  it("bounds it, since it is not always a ULID", () => {
    expect(unbanUserInput.safeParse({ userId: "x".repeat(65) }).success).toBe(
      false,
    );
    expect(unbanUserInput.safeParse({ userId: "x".repeat(64) }).success).toBe(
      true,
    );
  });
});

describe("runnersFilterInput (D8's search and filter)", () => {
  it("opens on everyone by default", () => {
    expect(runnersFilterInput.parse({}).filter).toBe("all");
  });

  it("takes reported and closed too", () => {
    expect(runnersFilterInput.parse({ filter: "reported" }).filter).toBe(
      "reported",
    );
    expect(runnersFilterInput.parse({ filter: "closed" }).filter).toBe(
      "closed",
    );
  });

  it("refuses a filter that is not one of the three", () => {
    expect(runnersFilterInput.safeParse({ filter: "banned" }).success).toBe(
      false,
    );
    expect(runnersFilterInput.safeParse({ filter: "" }).success).toBe(false);
  });

  it("trims the query and caps it at 254", () => {
    expect(
      runnersFilterInput.parse({ query: "  ada  ", filter: "all" }).query,
    ).toBe("ada");
    expect(
      runnersFilterInput.safeParse({ query: "x".repeat(255), filter: "all" })
        .success,
    ).toBe(false);
  });
});

/**
The Desk's rename, wired as its server function wires it.
*/
async function rename(
  userId: string,
  typed: string,
  db: ReturnType<typeof core> = core(),
) {
  return forceRename(db, {
    userId,
    typed,
    reason: "Offensive or sexual",
    recordedAs: renameRecord(db, {
      userId,
      actorId: "op",
      reason: "Offensive or sexual",
    }),
  });
}

async function historyOf(username: string) {
  return core()
    .select({
      userId: usernameHistory.userId,
      lockedAt: usernameHistory.lockedAt,
    })
    .from(usernameHistory)
    .where(eq(usernameHistory.username, username));
}

/**
 * A handle whose first batch (the read that decides) runs and whose second
 * (the write) fails with `message`.
 */
function failingOnWrite(message: string) {
  const real = core();
  const counter = { batches: 0 };
  // The first batch is the read that decides; the second writes.
  const batch: typeof real.batch = async (items) => {
    counter.batches += 1;
    if (counter.batches === 1) return real.batch(items);
    throw new Error(message);
  };
  return new Proxy(real, {
    get(target, property, receiver): unknown {
      return property === "batch"
        ? batch
        : Reflect.get(target, property, receiver);
    },
  });
}

describe("forceRename (round 27 #16), through account's rules", () => {
  beforeEach(freshState);

  it("pads the placeholder to four digits, and draws one at random", () => {
    expect(placeholderHandle(7)).toBe("runner_0007");
    expect(placeholderHandle(4821)).toBe("runner_4821");
    expect(placeholderHandle()).toMatch(/^runner_\d{4}$/u);
  });

  it("swaps the handle, locks the old one, owes a re-pick and records it", async () => {
    const runner = await makeUser({ username: "rudename" });

    const outcome = await rename(runner, "runner_4821");

    expect(outcome).toStrictEqual({ kind: "renamed", username: "runner_4821" });
    expect(await profileOf(runner)).toStrictEqual({
      username: "runner_4821",
      reason: "Offensive or sexual",
    });
    const [retired] = await historyOf("rudename");
    expect(retired?.userId).toBe(runner);
    expect(retired?.lockedAt).toBeTypeOf("number");
    const [audit] = await auditFor(runner);
    expect(audit).toMatchObject({
      action: "rename",
      actorId: "op",
      // A rename acts on the runner's profile, not on any of their posted
      // content — the audit's `subjectType` is what a reviewer later reads
      // to tell those apart.
      subjectType: "profile",
      subjectOwnerId: runner,
      reason: "Offensive or sexual (was @rudename)",
    });
  });

  it("retires the offending handle for everyone, its former holder included", async () => {
    const runner = await makeUser({ username: "rudename" });
    const other = await makeUser({ username: "someone_else" });
    await rename(runner, "runner_0100");

    expect(await claimUsername(core(), runner, "rudename")).toMatchObject({
      kind: "taken",
    });
    expect(await claimUsername(core(), other, "rudename")).toMatchObject({
      kind: "taken",
    });
    const renamed = await profileOf(runner);
    expect(renamed?.username).toBe("runner_0100");
    // The lock outlives the runner's later changes of their own.
    expect(await claimUsername(core(), runner, "fresh_pick")).toStrictEqual({
      kind: "claimed",
      username: "fresh_pick",
    });
    expect(await claimUsername(core(), runner, "rudename")).toMatchObject({
      kind: "taken",
    });
    expect(await historyOf("rudename")).toHaveLength(1);
  });

  it("still lets a runner take back a handle they gave up themselves", async () => {
    const runner = await makeUser({ username: "first" });
    await claimUsername(core(), runner, "second");

    expect(await claimUsername(core(), runner, "first")).toStrictEqual({
      kind: "claimed",
      username: "first",
    });
    expect(await historyOf("first")).toStrictEqual([]);
  });

  it("can hand the runner one of their own unlocked old handles", async () => {
    const runner = await makeUser({ username: "first" });
    await claimUsername(core(), runner, "rudename");

    expect(await rename(runner, "first")).toStrictEqual({
      kind: "renamed",
      username: "first",
    });
    expect(await historyOf("first")).toStrictEqual([]);
    const [locked] = await historyOf("rudename");
    expect(locked?.lockedAt).toBeTypeOf("number");
  });

  it("locks a handle already in the history rather than failing on it", async () => {
    const runner = await makeUser({ username: "rudename" });
    // A history row for the current handle is not a state a claim leaves,
    // but a lock must still land on it.
    await core().insert(usernameHistory).values({
      username: "rudename",
      userId: runner,
      retiredAt: 1,
    });

    expect(await rename(runner, "runner_0200")).toMatchObject({
      kind: "renamed",
    });
    const [row] = await historyOf("rudename");
    expect(row?.lockedAt).toBeTypeOf("number");
  });

  it("refuses a handle someone gave up, holds, or that is reserved or malformed, and writes nothing", async () => {
    const runner = await makeUser({ username: "rudename" });
    await core().insert(usernameHistory).values({
      username: "runner_0001",
      userId: "someone",
      retiredAt: 1,
    });
    await makeUser({ username: "runner_0002" });

    for (const typed of [
      "runner_0001",
      "runner_0002",
      "dialed_team",
      "Not A Handle!",
      "rudename",
    ]) {
      expect(await rename(runner, typed)).toStrictEqual({ kind: "taken" });
    }
    const unchanged = await profileOf(runner);
    expect(unchanged?.username).toBe("rudename");
    expect(unchanged?.reason ?? undefined).toBeUndefined();
    expect(await auditFor(runner)).toStrictEqual([]);
    expect(await historyOf("rudename")).toStrictEqual([]);
  });

  it("answers taken when the handle index refuses a race, and lets anything else through", async () => {
    const runner = await makeUser({ username: "rudename" });

    expect(
      await rename(
        runner,
        "runner_0003",
        failingOnWrite("UNIQUE constraint failed: user_profiles.username"),
      ),
    ).toStrictEqual({ kind: "taken" });
    await expect(
      rename(runner, "runner_0003", failingOnWrite("D1 is down")),
    ).rejects.toThrow("D1 is down");
  });

  it("answers not found for a runner with no handle", async () => {
    expect(await rename("nobody", "runner_0004")).toStrictEqual({
      kind: "not_found",
    });
  });
});

describe("deskRunners, D8 (round 27 #22)", () => {
  beforeEach(freshState);

  beforeEach(async () => {
    await core().delete(user);
  });

  it("lists every account newest first, with runs, profile reports and state", async () => {
    const older = await account("Ada@Example.com", "ada", 1000);
    const newer = await account("bo@example.com", "bo_runs", 2000);
    await makeRun({ userId: older });
    await makeRun({ userId: older });
    await core()
      .insert(reports)
      .values([
        {
          id: newUlid(),
          reporterId: newer,
          subjectType: "profile",
          subjectId: older,
          reason: "harassment",
          createdAt: 1,
        },
        {
          id: newUlid(),
          reporterId: newer,
          subjectType: "entry",
          subjectId: older,
          reason: "spam",
          createdAt: 1,
        },
      ]);
    await banUser({ userId: newer, reason: "Spam", bannedBy: "op" });

    const listed = await deskList({ filter: "all" });

    expect(listed).toStrictEqual([
      {
        userId: newer,
        username: "bo_runs",
        email: "bo@example.com",
        joinedAt: 2000,
        runs: 0,
        reports: 0,
        state: "CLOSED",
        banReason: "Spam",
      },
      {
        userId: older,
        username: "ada",
        email: "Ada@Example.com",
        joinedAt: 1000,
        runs: 2,
        reports: 1,
        state: "ACTIVE",
        banReason: undefined,
      },
    ]);
    expect(await accountCount(core())).toBe(2);
    expect(await idsFor({ filter: "reported" })).toStrictEqual([older]);
    expect(await idsFor({ filter: "closed" })).toStrictEqual([newer]);
  });

  it("searches a handle or an email by prefix, any case, with or without the @", async () => {
    const ada = await account("ada@example.com", "ada", 1000);
    const bo = await account("bo@example.com", "bo_runs", 2000);

    expect(await idsFor({ query: "@AD", filter: "all" })).toStrictEqual([ada]);
    expect(await idsFor({ query: "BO@", filter: "all" })).toStrictEqual([bo]);
    expect(await idsFor({ query: "", filter: "all" })).toStrictEqual([bo, ada]);
    // A typed wildcard is a character, not a pattern.
    expect(await idsFor({ query: "bo%", filter: "all" })).toStrictEqual([]);
    expect(await idsFor({ query: "_", filter: "all" })).toStrictEqual([]);
  });

  it("escapes LIKE's wildcards and its escape", () => {
    expect(prefixPattern("A_b%c\\")).toBe(String.raw`a\_b\%c\\%`);
    expect(ACCOUNTS_PAGE).toBe(100);
  });

  it("only strips a leading @, never one buried in the middle", async () => {
    await account("bo@example.com", "bo_runs", 2000);

    // Stripping the "@" wherever it falls would turn this into "bo_runs"
    // and find the row below by accident; only a leading "@" is the
    // "I typed a handle" marker the search box is for.
    expect(await idsFor({ query: "b@o_runs", filter: "all" })).toStrictEqual(
      [],
    );
  });

  it("treats a query key present but undefined the same as no search", async () => {
    const ada = await account("ada@example.com", "ada", 1000);
    const bo = await account("bo@example.com", "bo_runs", 2000);

    expect(await idsFor({ query: undefined, filter: "all" })).toStrictEqual([
      bo,
      ada,
    ]);
  });

  it("reads an account with no profile row as active, with no handle", async () => {
    const bare = newUlid();
    await core()
      .insert(user)
      .values({
        id: bare,
        name: "bare",
        email: "bare@example.com",
        emailVerified: true,
        createdAt: new Date(3000 * 1000),
        updatedAt: new Date(3000 * 1000),
      });

    expect(await deskList({ filter: "all" })).toStrictEqual([
      {
        userId: bare,
        username: undefined,
        email: "bare@example.com",
        joinedAt: 3000,
        runs: 0,
        reports: 0,
        state: "ACTIVE",
        banReason: undefined,
      },
    ]);
  });

  it("adds nothing, and reads nothing, for no accounts", async () => {
    expect(await deskRunners(core(), [])).toStrictEqual([]);
  });

  it("stops at a page", async () => {
    for (let index = 0; index < ACCOUNTS_PAGE + 1; index += 1) {
      await account(
        `r${String(index)}@example.com`,
        `r${String(index)}`,
        index,
      );
    }
    expect(await deskList({ filter: "all" })).toHaveLength(ACCOUNTS_PAGE);
  });
});

describe("the reviewer's row read is shared (runs untouched)", () => {
  it("keeps runs out of a moderation", async () => {
    // A guard for the entry path: removing an entry never deletes its run.
    await freshState();
    const { author, entryId } = await postedPhoto();
    await moderateContent(
      core(),
      {
        actorId: "m",
        action: "remove",
        subjectType: "entry",
        subjectId: entryId,
        reason: "rules",
      },
      quiet,
    );
    expect(
      await core().select().from(runs).where(eq(runs.userId, author)),
    ).toHaveLength(1);
  });
});
