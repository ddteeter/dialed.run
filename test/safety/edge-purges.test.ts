import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { entryPhotos, userProfiles } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { entryPhotoKeyFor } from "../../src/lib/entry-photo-key";
import { newUlid } from "../../src/lib/ids";
import { claimUsername, forceRename } from "../../src/modules/account";
import {
  deleteEntryPhoto,
  deleteRun,
  deleteRuns,
  retractEntries,
  retractEntry,
} from "../../src/modules/feed";
import { submitVerdict } from "../../src/modules/feed/entries";
import { moderateContent } from "../../src/modules/feed/moderation";
import { setPublicProfile } from "../../src/modules/onboarding/public-profile";
import {
  banUser,
  fileReport,
  fileTakedownRequest,
} from "../../src/modules/safety";
import {
  kitCacheTagsOf,
  subjectCacheTagsOf,
} from "../../src/modules/safety/kit-cache-tags";
import { purgeSpy } from "../purge-spy";
import { oweInCore } from "../queue-fakes";

import {
  makeEntry,
  makeRun,
  makeUser,
  makeVerifiedUser,
  resetSafetyTables,
} from "./helpers";

/**
 * Design 160's test plan: "each retraction path emits the entry's and
 * runner's tags". Every writer that takes a public page back hands the
 * edge one purge naming what it took; the ones that touch nothing public
 * name nothing.
 */
const core = () => drizzle(env.DIALED_CORE);

const quiet = vi.fn();

async function kit(audience: "private" | "runners" | "world" = "world") {
  const userId = await makeVerifiedUser();
  const runId = await makeRun({ userId });
  const entryId = await makeEntry({ userId, runId, audience });
  return { userId, runId, entryId };
}

async function photoOn(userId: string, entryId: string): Promise<string> {
  const photoId = newUlid();
  await core()
    .insert(entryPhotos)
    .values({
      id: photoId,
      entryId,
      photoKey: entryPhotoKeyFor(userId, entryId, photoId),
      position: 0,
      screenStatus: "pass",
    });
  return photoId;
}

function save(
  userId: string,
  entryId: string,
  audience: "private" | "runners" | "world",
) {
  return {
    userId,
    entryId,
    verdict: 0,
    audience,
    tags: [],
    itemFlags: [],
  };
}

beforeEach(async () => {
  await resetSafetyTables();
});

describe("a runner's own kit", () => {
  it.each([
    ["taken off PUBLIC", "world", "runners"],
    ["put on PUBLIC", "runners", "world"],
    ["edited while PUBLIC", "world", "world"],
  ] as const)("purges the kit when %s", async (_label, from, to) => {
    const { userId, entryId } = await kit(from);
    const spy = purgeSpy();

    await submitVerdict(save(userId, entryId, to), spy.purge);

    expect(spy.calls).toStrictEqual([[`entry:${entryId}`, `runner:${userId}`]]);
  });

  it("purges nothing for a kit that was never PUBLIC", async () => {
    const { userId, entryId } = await kit("private");
    const spy = purgeSpy();

    await submitVerdict(save(userId, entryId, "runners"), spy.purge);

    expect(spy.calls).toStrictEqual([]);
  });

  it("purges a deleted kit and its runner's pages", async () => {
    const { userId, entryId } = await kit();
    const spy = purgeSpy();

    await retractEntry(core(), userId, entryId, quiet, spy.purge);

    expect(spy.calls).toStrictEqual([[`entry:${entryId}`, `runner:${userId}`]]);
  });

  it("purges the kit on a deleted run, and nothing for a run with none", async () => {
    const { userId, runId, entryId } = await kit();
    const bare = await makeRun({ userId });
    const spy = purgeSpy();

    await deleteRun(core(), userId, runId, quiet, spy.purge);
    await deleteRun(core(), userId, bare, quiet, spy.purge);

    expect(spy.calls).toStrictEqual([
      [`entry:${entryId}`, `runner:${userId}`],
      [],
    ]);
  });

  it("purges a PUBLIC kit a photo is deleted from, and nothing for a SHARED one", async () => {
    const world = await kit("world");
    const shared = await kit("runners");
    const spy = purgeSpy();

    await deleteEntryPhoto(
      core(),
      world.userId,
      await photoOn(world.userId, world.entryId),
      quiet,
      spy.purge,
    );
    await deleteEntryPhoto(
      core(),
      shared.userId,
      await photoOn(shared.userId, shared.entryId),
      quiet,
      spy.purge,
    );

    expect(spy.calls).toStrictEqual([
      [`entry:${world.entryId}`, `runner:${world.userId}`],
    ]);
  });

  it("purges only the runner for all of a runner's kits, never one per kit", async () => {
    const { userId } = await kit();
    await makeEntry({ userId, runId: await makeRun({ userId }) });
    const spy = purgeSpy();

    await retractEntries(core(), userId, "all", quiet, spy.purge);
    await deleteRuns(core(), userId, "all", quiet, spy.purge);

    expect(spy.calls).toStrictEqual([
      [`runner:${userId}`],
      [`runner:${userId}`],
    ]);
  });
});

describe("the Desk, reports and requests", () => {
  it("purges a kit the Desk takes down", async () => {
    const { userId, entryId } = await kit();
    const spy = purgeSpy();

    await moderateContent(
      core(),
      {
        actorId: "moderator",
        action: "remove",
        subjectType: "entry",
        subjectId: entryId,
        reason: "spam",
      },
      quiet,
      spy.purge,
    );

    expect(spy.calls).toStrictEqual([[`entry:${entryId}`, `runner:${userId}`]]);
  });

  it("purges the kit a photo the Desk takes down was on, whose page shows it", async () => {
    const { userId, entryId } = await kit();
    const photoId = await photoOn(userId, entryId);
    const spy = purgeSpy();

    await moderateContent(
      core(),
      {
        actorId: "moderator",
        action: "remove",
        subjectType: "photo",
        subjectId: photoId,
        reason: "spam",
      },
      quiet,
      spy.purge,
    );

    expect(spy.calls).toStrictEqual([[`entry:${entryId}`, `runner:${userId}`]]);
  });

  it("purges a kit a report hides, and nothing for one it does not", async () => {
    const { userId, entryId } = await kit();
    const spy = purgeSpy();
    const report = (reason: "spam" | "intimate") =>
      fileReport(
        {
          reporterId: newUlid(),
          subjectType: "entry",
          subjectId: entryId,
          reason,
        },
        oweInCore,
        spy.purge,
      );

    await report("spam");
    expect(spy.calls).toStrictEqual([]);

    await report("intimate");
    expect(spy.calls).toStrictEqual([[`entry:${entryId}`, `runner:${userId}`]]);
  });

  it("purges the kit a photo a report hides is on", async () => {
    const { userId, entryId } = await kit();
    const photoId = await photoOn(userId, entryId);
    const spy = purgeSpy();

    await fileReport(
      {
        reporterId: newUlid(),
        subjectType: "photo",
        subjectId: photoId,
        reason: "intimate",
      },
      oweInCore,
      spy.purge,
    );

    expect(spy.calls).toStrictEqual([[`entry:${entryId}`, `runner:${userId}`]]);
  });

  it("names nothing for a profile or a product, and nothing for a photo that is gone", async () => {
    // An id a photo also has, so only the subject's type can say "none".
    const { userId, entryId } = await kit();
    const sharedId = await photoOn(userId, entryId);
    expect(await subjectCacheTagsOf(core(), "profile", sharedId)).toStrictEqual(
      [],
    );
    expect(await subjectCacheTagsOf(core(), "product", sharedId)).toStrictEqual(
      [],
    );
    expect(await subjectCacheTagsOf(core(), "photo", newUlid())).toStrictEqual(
      [],
    );
  });

  it.each([
    ["a public kit's own link", (entryId: string) => `/k/${entryId}`],
    ["the app's link", (entryId: string) => `/feed/entry/${entryId}`],
  ])("purges a kit a removal request holds, by %s", async (_label, path) => {
    const { userId, entryId } = await kit();
    const spy = purgeSpy();

    await fileTakedownRequest(
      core(),
      {
        email: `${newUlid().toLowerCase()}@example.com`,
        signature: "Sam Runner",
        location: `https://dialed.run${path(entryId)}`,
        description: "",
        isAttested: true,
        idempotencyKey: newUlid(),
        attempt: "token",
        remoteIp: "203.0.113.9",
        isLimited: false,
      },
      {
        verify: () => Promise.resolve({ ok: true }),
        owe: oweInCore,
        purge: spy.purge,
      },
    );

    expect(spy.calls).toStrictEqual([[`entry:${entryId}`, `runner:${userId}`]]);
  });

  it("purges the kit a photo a removal request holds is on", async () => {
    const { userId, entryId } = await kit();
    const photoId = await photoOn(userId, entryId);
    const spy = purgeSpy();

    await fileTakedownRequest(
      core(),
      {
        email: "sam@example.com",
        signature: "Sam Runner",
        location: `https://dialed.run/feed/photo/entries/${userId}/${entryId}/${photoId}`,
        description: "",
        isAttested: true,
        idempotencyKey: newUlid(),
        attempt: "token",
        remoteIp: "203.0.113.9",
        isLimited: false,
      },
      {
        verify: () => Promise.resolve({ ok: true }),
        owe: oweInCore,
        purge: spy.purge,
      },
    );

    expect(spy.calls).toStrictEqual([[`entry:${entryId}`, `runner:${userId}`]]);
  });

  it("names a kit that is gone by its own page alone", async () => {
    const entryId = newUlid();

    expect(await kitCacheTagsOf(core(), entryId)).toStrictEqual([
      `entry:${entryId}`,
    ]);
  });

  it("purges everything of a banned runner's with one tag", async () => {
    const userId = await makeUser();
    const spy = purgeSpy();

    await banUser(
      { userId, reason: "spam", rule: "spam", bannedBy: "moderator" },
      spy.purge,
    );

    expect(spy.calls).toStrictEqual([[`runner:${userId}`]]);
  });
});

describe("a runner's profile", () => {
  const CLEAR = () => Promise.resolve("clear" as const);

  it("purges the runner and the new handle's path on a new handle", async () => {
    const userId = await makeUser({ username: "maya_runs" });
    const spy = purgeSpy();

    await claimUsername(core(), userId, "maya_trails", CLEAR, spy.purge);
    await claimUsername(core(), userId, "maya_trails", CLEAR, spy.purge);

    // The second claim writes nothing, so it purges nothing.
    expect(spy.calls).toStrictEqual([
      [`runner:${userId}`, "handle:maya_trails"],
    ]);
  });

  it("purges nothing when the handle is refused", async () => {
    await makeUser({ username: "taken_one" });
    const userId = await makeUser({ username: "maya_runs" });
    const spy = purgeSpy();

    await claimUsername(core(), userId, "taken_one", CLEAR, spy.purge);

    expect(spy.calls).toStrictEqual([]);
  });

  it("purges the runner and the placeholder's path on a moderator's rename", async () => {
    const userId = await makeUser({ username: "quadzilla_69" });
    const spy = purgeSpy();

    await forceRename(
      core(),
      {
        userId,
        typed: "runner_4821",
        reason: "Offensive or sexual",
        recordedAs: () => core().select().from(userProfiles).limit(0),
      },
      spy.purge,
    );

    expect(spy.calls).toStrictEqual([
      [`runner:${userId}`, "handle:runner_4821"],
    ]);
  });

  it("purges nothing for a rename that did not happen", async () => {
    await makeUser({ username: "runner_4821" });
    const userId = await makeUser({ username: "quadzilla_69" });
    const spy = purgeSpy();

    await forceRename(
      core(),
      {
        userId,
        typed: "runner_4821",
        reason: "Offensive or sexual",
        recordedAs: () => core().select().from(userProfiles).limit(0),
      },
      spy.purge,
    );

    expect(spy.calls).toStrictEqual([]);
  });

  it.each([
    ["the profile on", { publicProfile: true }],
    ["the profile off", { publicProfile: false }],
    ["the closet off", { publicCloset: false }],
  ] as const)(
    "purges the runner and their handle's path for %s",
    async (_label, choice) => {
      const userId = await makeUser({ username: "maya_runs" });
      const spy = purgeSpy();

      await setPublicProfile(core(), userId, choice, spy.purge);

      expect(spy.calls).toStrictEqual([
        [`runner:${userId}`, "handle:maya_runs"],
      ]);
    },
  );

  it("purges only the runner when they hold no handle yet", async () => {
    const userId = newUlid();
    const spy = purgeSpy();

    await setPublicProfile(core(), userId, { publicProfile: false }, spy.purge);

    expect(spy.calls).toStrictEqual([[`runner:${userId}`]]);
  });
});
