import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { user } from "../../src/db/schema-auth";
import {
  entryPhotos,
  moderationActions,
  notifications,
  outfitEntries,
  products,
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
import { photoResponse } from "../../src/modules/feed/photos";
import {
  accountCount,
  banUser,
  deskRunners,
  forceRename,
  placeholderHandle,
  prefixPattern,
  removalReasons,
  removalReasonSchema,
  removalSentence,
  removalStatements,
  renameReasonSchema,
  runnersFilterInput,
  RUNNERS_PAGE,
  takedownInput,
  unbanUser,
  unbanUserInput,
} from "../../src/modules/safety";
import { isUniqueViolation } from "../../src/modules/safety/rename";

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

async function idsFor(filter: {
  query?: string | undefined;
  filter: "all" | "reported" | "closed";
}): Promise<string[]> {
  const listed = await deskRunners(core(), filter);
  return listed.map((runner) => runner.userId);
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
});

describe("quarantine: one copy, where no route looks (SAF-5)", () => {
  beforeEach(freshState);

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

describe("forceRename (round 27 #16)", () => {
  beforeEach(freshState);

  it("pads the placeholder to four digits, and draws one at random", () => {
    expect(placeholderHandle(7)).toBe("runner_0007");
    expect(placeholderHandle(4821)).toBe("runner_4821");
    expect(placeholderHandle()).toMatch(/^runner_\d{4}$/u);
  });

  it("swaps the handle, retires the old one, owes a re-pick and records it", async () => {
    const runner = await makeUser({ username: "rudename" });

    const outcome = await forceRename(core(), {
      userId: runner,
      actorId: "op",
      reason: "Offensive or sexual",
      replacement: "runner_4821",
    });

    expect(outcome).toStrictEqual({ kind: "renamed", username: "runner_4821" });
    expect(await profileOf(runner)).toStrictEqual({
      username: "runner_4821",
      reason: "Offensive or sexual",
    });
    const [retired] = await core()
      .select({ userId: usernameHistory.userId })
      .from(usernameHistory)
      .where(eq(usernameHistory.username, "rudename"));
    expect(retired?.userId).toBe(runner);
    const [audit] = await auditFor(runner);
    expect(audit).toMatchObject({
      action: "rename",
      actorId: "op",
      // A rename acts on the runner's profile, not on any of their posted
      // content — the audit's `subjectType` is what a reviewer later reads
      // to tell those apart.
      subjectType: "profile",
      reason: "Offensive or sexual (was @rudename)",
    });
  });

  it("collides only on the unique-handle index, and lets anything else through", () => {
    // The batch's catch exists for one real failure: two concurrent
    // renames racing the unique-handle index. Any other D1 failure must
    // still surface as an error rather than being reported as a placeholder
    // collision, which is why this is asserted on both sides.
    expect(
      isUniqueViolation(
        new Error("D1_ERROR: UNIQUE constraint failed: user_profiles.username"),
      ),
    ).toBe(true);
    expect(
      isUniqueViolation(
        new Error(
          "D1_ERROR: NOT NULL constraint failed: user_profiles.user_id",
        ),
      ),
    ).toBe(false);
  });

  it("refuses a placeholder someone gave up, or holds, and writes nothing", async () => {
    const runner = await makeUser({ username: "rudename" });
    await core().insert(usernameHistory).values({
      username: "runner_0001",
      userId: "someone",
      retiredAt: 1,
    });
    await makeUser({ username: "runner_0002" });

    expect(
      await forceRename(core(), {
        userId: runner,
        actorId: "op",
        reason: "Advertising",
        replacement: "runner_0001",
      }),
    ).toStrictEqual({ kind: "collided" });
    expect(
      await forceRename(core(), {
        userId: runner,
        actorId: "op",
        reason: "Advertising",
        replacement: "runner_0002",
      }),
    ).toStrictEqual({ kind: "collided" });
    const unchanged = await profileOf(runner);
    expect(unchanged?.username).toBe("rudename");
  });

  it("lets any other failure of the write through", async () => {
    const runner = await makeUser({ username: "rudename" });
    const real = core();
    const failing = new Proxy(real, {
      get(target, property, receiver): unknown {
        return property === "batch"
          ? () => Promise.reject(new Error("D1 is down"))
          : Reflect.get(target, property, receiver);
      },
    });

    await expect(
      forceRename(failing, {
        userId: runner,
        actorId: "op",
        reason: "Advertising",
        replacement: "runner_0003",
      }),
    ).rejects.toThrow("D1 is down");
  });

  it("answers not found for a runner with no handle", async () => {
    expect(
      await forceRename(core(), {
        userId: "nobody",
        actorId: "op",
        reason: "Advertising",
      }),
    ).toStrictEqual({ kind: "not_found" });
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

    const listed = await deskRunners(core(), { filter: "all" });

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
    expect(RUNNERS_PAGE).toBe(100);
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

  it("stops at a page", async () => {
    for (let index = 0; index < RUNNERS_PAGE + 1; index += 1) {
      await account(
        `r${String(index)}@example.com`,
        `r${String(index)}`,
        index,
      );
    }
    expect(await deskRunners(core(), { filter: "all" })).toHaveLength(
      RUNNERS_PAGE,
    );
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
