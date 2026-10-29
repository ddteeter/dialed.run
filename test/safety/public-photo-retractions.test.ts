import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { entryPhotos, publicPhotos } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { scopeOfTags, type PurgeTags } from "../../src/lib/cache-tags";
import { entryPhotoKeyFor } from "../../src/lib/entry-photo-key";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { newPublicPhotoKey } from "../../src/lib/public-photos";
import { requestAccountDeletion } from "../../src/modules/account/deletion";
import {
  deleteEntryPhoto,
  deleteRun,
  deleteRuns,
  retractEntry,
} from "../../src/modules/feed";
import { submitVerdict } from "../../src/modules/feed/entries";
import { moderateContent } from "../../src/modules/feed/moderation";
import {
  syncPublicPhotos,
  type PublicPhotoDeps,
} from "../../src/modules/ops/public-photos";
import {
  banUser,
  fileReport,
  fileTakedownRequest,
} from "../../src/modules/safety";
import { oweInCore } from "../queue-fakes";

import {
  makeEntry,
  makeRun,
  makeVerifiedUser,
  resetSafetyTables,
} from "./helpers";

/**
 * Design 160 step 8, the legal review's ask: every path that takes a kit
 * or its photo off the open web deletes the photo's public copy, and
 * purges the page that showed it. Each path runs as production wires it:
 * its purge is `purgeAndSync`'s shape, recording the tags and running the
 * public photo reconcile for what they name, against the real buckets.
 */
const core = () => drizzle(env.DIALED_CORE);

const quiet = vi.fn();

function deps(): PublicPhotoDeps {
  return {
    db: core(),
    media: env.MEDIA,
    bucket: env.PUBLIC_PHOTOS,
    isPublishing: true,
    newKey: newPublicPhotoKey,
    report: quiet,
  };
}

/**
The purge as the Worker wires it, with what each call named, and its syncs.
*/
function wiredPurge() {
  const calls: string[][] = [];
  const syncs: Promise<number>[] = [];
  const purge: PurgeTags = (tags) => {
    calls.push([...tags]);
    syncs.push(syncPublicPhotos(deps(), scopeOfTags(tags)));
  };
  return { purge, calls, settled: () => Promise.all(syncs) };
}

interface Copied {
  readonly userId: string;
  readonly runId: string;
  readonly entryId: string;
  readonly photoId: string;
  readonly key: string;
}

/**
A PUBLIC kit with a screened photo, copied to the public bucket.
*/
async function copied(): Promise<Copied> {
  const userId = await makeVerifiedUser();
  const runId = await makeRun({ userId });
  const entryId = await makeEntry({ userId, runId, audience: "world" });
  const photoId = newUlid();
  const photoKey = entryPhotoKeyFor(userId, entryId, photoId);
  await env.MEDIA.put(photoKey, new Uint8Array([0xff, 0xd8, 0xff]), {
    httpMetadata: { contentType: "image/jpeg" },
  });
  await core()
    .insert(entryPhotos)
    .values({
      id: photoId,
      entryId,
      photoKey,
      position: 0,
      screenStatus: "pass",
    });
  await syncPublicPhotos(deps(), { entryIds: [entryId], runnerIds: [] });
  const [copy] = await core().select().from(publicPhotos);
  const key = copy?.key ?? "";
  expect(await env.PUBLIC_PHOTOS.head(key)).not.toBeNull();
  return { userId, runId, entryId, photoId, key };
}

async function expectWithdrawn(copy: Copied): Promise<void> {
  expect(await env.PUBLIC_PHOTOS.head(copy.key)).toBeNull();
  expect(await core().select().from(publicPhotos)).toStrictEqual([]);
}

function kitTags(copy: Copied): string[] {
  return [`entry:${copy.entryId}`, `runner:${copy.userId}`];
}

function desk(
  action: "remove" | "quarantine" | "takedown",
  subject: "entry" | "photo",
  copy: Copied,
  purge: PurgeTags,
) {
  return moderateContent(
    core(),
    {
      actorId: "moderator",
      action,
      subjectType: subject,
      subjectId: subject === "entry" ? copy.entryId : copy.photoId,
      reason: action === "takedown" ? "copyright" : "explicit",
    },
    quiet,
    purge,
  );
}

function requestRemoval(location: string, purge: PurgeTags) {
  return fileTakedownRequest(
    core(),
    {
      email: `${newUlid().toLowerCase()}@example.com`,
      signature: "Sam Runner",
      location,
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
      purge,
    },
  );
}

function reportFor(
  subjectType: "entry" | "photo",
  subjectId: string,
  purge: PurgeTags,
) {
  return fileReport(
    { reporterId: newUlid(), subjectType, subjectId, reason: "intimate" },
    oweInCore,
    purge,
  );
}

beforeEach(async () => {
  await resetSafetyTables();
  const listed = await env.PUBLIC_PHOTOS.list();
  const keys = listed.objects.map((object) => object.key);
  if (keys.length > 0) await env.PUBLIC_PHOTOS.delete(keys);
});

describe("a takedown deletes the public copy and purges the page", () => {
  it.each<[string, (copy: Copied, purge: PurgeTags) => Promise<unknown>]>([
    [
      "the Desk removes the kit",
      (copy, purge) => desk("remove", "entry", copy, purge),
    ],
    [
      "the Desk removes the photo",
      (copy, purge) => desk("remove", "photo", copy, purge),
    ],
    [
      "the Desk quarantines the kit as suspected CSAM",
      (copy, purge) => desk("quarantine", "entry", copy, purge),
    ],
    [
      "the Desk quarantines the photo as suspected CSAM",
      (copy, purge) => desk("quarantine", "photo", copy, purge),
    ],
    [
      "a copyright notice holds the kit",
      (copy, purge) => desk("takedown", "entry", copy, purge),
    ],
    [
      "a copyright notice holds the photo",
      (copy, purge) => desk("takedown", "photo", copy, purge),
    ],
    [
      "a removal request holds the kit by its public link",
      (copy, purge) =>
        requestRemoval(`https://dialed.run/k/${copy.entryId}`, purge),
    ],
    [
      "a removal request holds the photo",
      (copy, purge) =>
        requestRemoval(
          `https://dialed.run/feed/photo/entries/${copy.userId}/${copy.entryId}/${copy.photoId}`,
          purge,
        ),
    ],
  ])("when %s", async (_label, takeDown) => {
    const copy = await copied();
    const wired = wiredPurge();

    await takeDown(copy, wired.purge);
    await wired.settled();

    await expectWithdrawn(copy);
    expect(wired.calls).toStrictEqual([kitTags(copy)]);
  });
});

describe("every other retraction deletes the public copy", () => {
  it.each<[string, (copy: Copied, purge: PurgeTags) => Promise<unknown>]>([
    [
      "the runner takes the kit off PUBLIC",
      (copy, purge) =>
        submitVerdict(
          {
            userId: copy.userId,
            entryId: copy.entryId,
            verdict: 0,
            audience: "runners",
            tags: [],
            itemFlags: [],
          },
          purge,
        ),
    ],
    [
      "the runner deletes the kit",
      (copy, purge) =>
        retractEntry(core(), copy.userId, copy.entryId, quiet, purge),
    ],
    [
      "the runner deletes the run",
      (copy, purge) => deleteRun(core(), copy.userId, copy.runId, quiet, purge),
    ],
    [
      "the runner deletes the photo",
      (copy, purge) =>
        deleteEntryPhoto(core(), copy.userId, copy.photoId, quiet, purge),
    ],
    [
      "a report hides the kit",
      (copy, purge) => reportFor("entry", copy.entryId, purge),
    ],
    [
      "a report hides the photo",
      (copy, purge) => reportFor("photo", copy.photoId, purge),
    ],
  ])("when %s", async (_label, takeBack) => {
    const copy = await copied();
    const wired = wiredPurge();

    await takeBack(copy, wired.purge);
    await wired.settled();

    await expectWithdrawn(copy);
    expect(wired.calls).toStrictEqual([kitTags(copy)]);
  });

  it.each<[string, (copy: Copied, purge: PurgeTags) => Promise<unknown>]>([
    [
      "the runner is banned",
      (copy, purge) =>
        banUser(
          {
            userId: copy.userId,
            reason: "spam",
            rule: "spam",
            bannedBy: "moderator",
          },
          purge,
        ),
    ],
    [
      "the runner asks to leave",
      (copy, purge) =>
        requestAccountDeletion(
          core(),
          {
            userId: copy.userId,
            currentPassword: undefined,
            checkPassword: vi.fn(),
            signedInAt: nowSeconds(),
          },
          {
            keepAlive: quiet,
            report: quiet,
            settle: () => Promise.resolve(),
            disconnectStrava: () => Promise.resolve(),
            purge,
          },
        ),
    ],
    [
      "the account is deleted",
      (copy, purge) => deleteRuns(core(), copy.userId, "all", quiet, purge),
    ],
  ])("when %s", async (_label, takeAway) => {
    const copy = await copied();
    const wired = wiredPurge();

    await takeAway(copy, wired.purge);
    await wired.settled();

    await expectWithdrawn(copy);
    expect(wired.calls).toStrictEqual([[`runner:${copy.userId}`]]);
  });
});
