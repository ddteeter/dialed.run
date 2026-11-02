import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { z } from "zod";

import {
  entryPhotos,
  moderationActions,
  notifications,
  outbox,
  outfitEntries,
  reviewQueue,
  takedownRequests,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { readOutboxRow } from "../../src/lib/sql/outbox";
import { decideRemovalRequest } from "../../src/modules/feed/removal-requests";
import { fileTakedownRequest } from "../../src/modules/safety";
import { HIDDEN_NOTICE } from "../../src/modules/safety/notice-copy";
import { noPurge } from "../purge-spy";
import { oweInCore } from "../queue-fakes";

import { makeEntry, makeRun, makeUser, resetSafetyTables } from "./helpers";

/**
 * An operator's decision on a `/takedown` request (design 136, D-117):
 * take the kit down and tell the requester, or decline with a reason and
 * tell them that — exactly once either way.
 */
const NOW = 1_800_000_000;

function core() {
  return drizzle(env.DIALED_CORE);
}

async function sharedEntry(): Promise<string> {
  const author = await makeUser();
  const runId = await makeRun({ userId: author });
  return makeEntry({ userId: author, runId, audience: "runners" });
}

async function seedRequest(
  subject: { subjectType: "entry" | "photo"; subjectId: string } | undefined,
): Promise<string> {
  const id = newUlid();
  await core()
    .insert(takedownRequests)
    .values({
      id,
      requesterEmail: "sam@example.com",
      signature: "Sam Runner",
      location:
        subject === undefined
          ? "a photo on a site that is not ours"
          : `https://dialed.run/feed/entry/${subject.subjectId}`,
      subjectType: subject?.subjectType,
      subjectId: subject?.subjectId,
      dueAt: NOW + 172_800,
      createdAt: NOW,
      idempotencyKey: newUlid(),
    });
  return id;
}

async function requestRow(id: string) {
  const [row] = await core()
    .select()
    .from(takedownRequests)
    .where(eq(takedownRequests.id, id));
  return row;
}

const told = z.object({
  dedupeKey: z.string(),
  email: z.object({ to: z.unknown(), template: z.unknown() }),
});

async function emailsTo(address: string) {
  const rows = await core()
    .select({ payload: outbox.payload })
    .from(outbox)
    .where(eq(outbox.kind, "email"));
  return rows
    .map((row) => {
      const read = readOutboxRow("email", row.payload);
      if (!read.ok) throw new Error(read.problem);
      return told.parse(read.message.payload);
    })
    .filter((email) => JSON.stringify(email.email.to).includes(address));
}

beforeEach(async () => {
  await resetSafetyTables();
  await core().delete(takedownRequests);
});

describe("taking it down", () => {
  it("takes the kit down as an intimate image, marks the request, and tells the requester once", async () => {
    const entryId = await sharedEntry();
    const id = await seedRequest({ subjectType: "entry", subjectId: entryId });

    expect(
      await decideRemovalRequest(
        core(),
        "op-one",
        id,
        { outcome: "removed" },
        NOW,
      ),
    ).toBe("decided");

    const [entry] = await core()
      .select()
      .from(outfitEntries)
      .where(eq(outfitEntries.id, entryId));
    expect(entry).toBeUndefined();
    const [action] = await core()
      .select()
      .from(moderationActions)
      .where(eq(moderationActions.subjectId, entryId));
    expect(action).toMatchObject({
      action: "takedown",
      actorId: "op-one",
      reason: `it's an intimate image shared without consent — removal request ${id}`,
    });
    expect(await requestRow(id)).toMatchObject({
      status: "removed",
      resolvedAt: NOW,
      resolvedBy: "op-one",
    });
    const decided = await requestRow(id);
    expect(decided?.declineReason).toBeNull();
    expect(await emailsTo("sam@example.com")).toStrictEqual([
      {
        dedupeKey: `removal_request_decided:${id}`,
        email: {
          to: { address: "sam@example.com" },
          template: { kind: "removal_request_decided", outcome: "removed" },
        },
      },
    ]);
  });

  it("marks a request whose link was not ours, taking nothing down", async () => {
    const entryId = await sharedEntry();
    const id = await seedRequest(undefined);

    await decideRemovalRequest(
      core(),
      "op-one",
      id,
      { outcome: "removed" },
      NOW,
    );

    const row = await requestRow(id);
    expect(row?.status).toBe("removed");
    const [entry] = await core()
      .select()
      .from(outfitEntries)
      .where(eq(outfitEntries.id, entryId));
    expect(entry).toBeDefined();
  });

  it("finishes a decision whose takedown already landed, as a retry would", async () => {
    const entryId = await sharedEntry();
    const id = await seedRequest({ subjectType: "entry", subjectId: entryId });
    await core().delete(outfitEntries).where(eq(outfitEntries.id, entryId));

    expect(
      await decideRemovalRequest(
        core(),
        "op-one",
        id,
        { outcome: "removed" },
        NOW,
      ),
    ).toBe("decided");
    const row = await requestRow(id);
    expect(row?.status).toBe("removed");
  });
});

describe("declining", () => {
  it("keeps the kit, records the reason, and sends it to the requester", async () => {
    const entryId = await sharedEntry();
    const id = await seedRequest({ subjectType: "entry", subjectId: entryId });

    await decideRemovalRequest(
      core(),
      "op-two",
      id,
      { outcome: "declined", reason: "it is a photo of shoes" },
      NOW,
    );

    expect(await requestRow(id)).toMatchObject({
      status: "declined",
      declineReason: "it is a photo of shoes",
      resolvedAt: NOW,
      resolvedBy: "op-two",
    });
    const [entry] = await core()
      .select()
      .from(outfitEntries)
      .where(eq(outfitEntries.id, entryId));
    expect(entry).toBeDefined();
    expect(await emailsTo("sam@example.com")).toStrictEqual([
      {
        dedupeKey: `removal_request_decided:${id}`,
        email: {
          to: { address: "sam@example.com" },
          template: {
            kind: "removal_request_decided",
            outcome: "declined",
            reason: "it is a photo of shoes",
          },
        },
      },
    ]);
  });
});

describe("a request already decided, or never made", () => {
  it("answers a second decision without writing or sending anything", async () => {
    const id = await seedRequest(undefined);
    await decideRemovalRequest(
      core(),
      "op-one",
      id,
      { outcome: "removed" },
      NOW,
    );

    expect(
      await decideRemovalRequest(
        core(),
        "op-two",
        id,
        { outcome: "declined", reason: "no" },
        NOW + 60,
      ),
    ).toBe("already_decided");
    expect(await requestRow(id)).toMatchObject({
      status: "removed",
      resolvedBy: "op-one",
    });
    expect(await emailsTo("sam@example.com")).toHaveLength(1);
  });

  it("says not found for an id nobody filed", async () => {
    expect(
      await decideRemovalRequest(
        core(),
        "op-one",
        newUlid(),
        { outcome: "removed" },
        NOW,
      ),
    ).toBe("not_found");
  });
});

/**
 * Round 35 #58e: a request whose link is ours hides it at once, as a W1
 * report of the reason does; a Decline gives it back.
 */
const deps = {
  verify: () => Promise.resolve({ ok: true }),
  owe: oweInCore,
  purge: noPurge,
};

async function file(location: string): Promise<string> {
  await fileTakedownRequest(
    core(),
    {
      email: "sam@example.com",
      signature: "Sam Runner",
      location,
      description: "",
      isAttested: true,
      idempotencyKey: newUlid(),
      attempt: "token",
      remoteIp: undefined,
      isLimited: false,
    },
    deps,
    NOW,
  );
  const [row] = await core()
    .select({ id: takedownRequests.id })
    .from(takedownRequests)
    .where(eq(takedownRequests.location, location));
  if (row === undefined) throw new Error("no request filed");
  return row.id;
}

async function entryStatus(entryId: string) {
  const [row] = await core()
    .select({ status: outfitEntries.moderationStatus })
    .from(outfitEntries)
    .where(eq(outfitEntries.id, entryId));
  return row?.status;
}

async function photoOn(
  entryId: string,
  screenStatus: "pending" | "pass" | "flagged",
): Promise<string> {
  const id = newUlid();
  await core()
    .insert(entryPhotos)
    .values({
      id,
      entryId,
      photoKey: `entries/u/${entryId}/${id}`,
      position: 0,
      screenStatus,
    });
  return id;
}

async function photoStatus(id: string) {
  const [row] = await core()
    .select({ status: entryPhotos.screenStatus })
    .from(entryPhotos)
    .where(eq(entryPhotos.id, id));
  return row?.status;
}

async function decline(id: string) {
  return decideRemovalRequest(
    core(),
    "op-one",
    id,
    { outcome: "declined", reason: "shoes" },
    NOW,
  );
}

const entryLink = (entryId: string) =>
  `https://dialed.run/feed/entry/${entryId}`;
const photoLink = (entryId: string, photoId: string) =>
  `https://dialed.run/feed/photo/entries/u/${entryId}/${photoId}`;

describe("the hold a request puts on what it names", () => {
  it("hides a public kit at once, and a Decline gives it back", async () => {
    const entryId = await sharedEntry();
    const id = await file(entryLink(entryId));
    expect(await entryStatus(entryId)).toBe("hidden_pending_review");

    await decline(id);
    expect(await entryStatus(entryId)).toBe("ok");
  });

  it("hides a photo, screened or not, and gives it back unscreened", async () => {
    const entryId = await sharedEntry();
    for (const screened of ["pass", "pending"] as const) {
      const photoId = await photoOn(entryId, screened);
      const id = await file(photoLink(entryId, photoId));
      expect(await photoStatus(photoId)).toBe("hidden_pending_review");
      await decline(id);
      // Back to `pending`, never `pass`, as an approval leaves it.
      expect(await photoStatus(photoId)).toBe("pending");
    }
  });

  it("never touches a removed kit or a flagged photo", async () => {
    const entryId = await sharedEntry();
    await core()
      .update(outfitEntries)
      .set({ moderationStatus: "removed" })
      .where(eq(outfitEntries.id, entryId));
    const photoId = await photoOn(entryId, "flagged");
    await file(entryLink(entryId));
    await file(photoLink(entryId, photoId));
    expect(await entryStatus(entryId)).toBe("removed");
    expect(await photoStatus(photoId)).toBe("flagged");
  });

  it.each(["pending", "reviewing"] as const)(
    "keeps it hidden after a Decline while a review row is open on it, %s",
    async (status) => {
      const entryId = await sharedEntry();
      const id = await file(entryLink(entryId));
      await core().insert(reviewQueue).values({
        id: newUlid(),
        subjectType: "entry",
        subjectId: entryId,
        source: "reports",
        status,
        createdAt: NOW,
      });
      await decline(id);
      expect(await entryStatus(entryId)).toBe("hidden_pending_review");
    },
  );

  it("declines a link that is not ours, with nothing to give back", async () => {
    const id = await file("https://elsewhere.example/img");
    expect(await decline(id)).toBe("decided");
    const [row] = await core()
      .select({ status: takedownRequests.status })
      .from(takedownRequests)
      .where(eq(takedownRequests.id, id));
    expect(row?.status).toBe("declined");
  });

  it("gives it back once a settled review row is all that is left", async () => {
    const entryId = await sharedEntry();
    const id = await file(entryLink(entryId));
    await core().insert(reviewQueue).values({
      id: newUlid(),
      subjectType: "entry",
      subjectId: entryId,
      source: "reports",
      status: "approved",
      createdAt: NOW,
    });
    await decline(id);
    expect(await entryStatus(entryId)).toBe("ok");
  });

  it("keeps it hidden after a Decline while another request for it is pending", async () => {
    const entryId = await sharedEntry();
    const first = await file(entryLink(entryId));
    await file(`${entryLink(entryId)}/`);
    await decline(first);
    expect(await entryStatus(entryId)).toBe("hidden_pending_review");
  });

  it("gives back nothing when the Decline's claim did not land", async () => {
    // Another operator took it down first: the request is no longer the
    // one this decision declined, so nothing comes back.
    const entryId = await sharedEntry();
    const id = await file(entryLink(entryId));
    await core()
      .update(takedownRequests)
      .set({ status: "removed", resolvedAt: NOW })
      .where(eq(takedownRequests.id, id));
    expect(await decline(id)).toBe("already_decided");
    expect(await entryStatus(entryId)).toBe("hidden_pending_review");
  });

  it("hides nothing for a link that is not ours", async () => {
    const entryId = await sharedEntry();
    await file("https://elsewhere.example/img");
    expect(await entryStatus(entryId)).toBe("ok");
  });
});

/**
The author of a kit, and the hide notices they hold: kind, subject, body, read.
*/
async function authorOf(entryId: string): Promise<string> {
  const [row] = await core()
    .select({ userId: outfitEntries.userId })
    .from(outfitEntries)
    .where(eq(outfitEntries.id, entryId));
  if (row === undefined) throw new Error("no kit");
  return row.userId;
}

async function hideNoticesFor(userId: string) {
  return core()
    .select({
      kind: notifications.kind,
      subjectId: notifications.subjectId,
      body: notifications.body,
      read: notifications.read,
    })
    .from(notifications)
    .where(eq(notifications.userId, userId));
}

const byId = (one: string, other: string) => one.localeCompare(other);

describe("the author's notice of a request's hold (R-163)", () => {
  beforeEach(async () => {
    await core().delete(notifications);
  });

  it("tells the author of a kit it holds, in the hide notice's words", async () => {
    const entryId = await sharedEntry();
    await file(entryLink(entryId));
    expect(await hideNoticesFor(await authorOf(entryId))).toStrictEqual([
      {
        kind: "content_hidden",
        subjectId: entryId,
        body: HIDDEN_NOTICE.entry,
        read: false,
      },
    ]);
  });

  it("tells the author of a photo it holds, screened or not", async () => {
    const entryId = await sharedEntry();
    const author = await authorOf(entryId);
    const photos = [
      await photoOn(entryId, "pass"),
      await photoOn(entryId, "pending"),
    ];
    for (const photoId of photos) await file(photoLink(entryId, photoId));
    const notices = await hideNoticesFor(author);
    expect(
      notices.map((notice) => notice.subjectId ?? "").toSorted(byId),
    ).toStrictEqual(photos.toSorted(byId));
    for (const notice of notices) {
      expect(notice).toMatchObject({
        kind: "content_hidden",
        body: HIDDEN_NOTICE.photo,
      });
    }
  });

  it("tells nobody of a removed kit or a flagged photo, which it does not move", async () => {
    const entryId = await sharedEntry();
    await core()
      .update(outfitEntries)
      .set({ moderationStatus: "removed" })
      .where(eq(outfitEntries.id, entryId));
    const photoId = await photoOn(entryId, "flagged");
    await file(entryLink(entryId));
    await file(photoLink(entryId, photoId));
    expect(await hideNoticesFor(await authorOf(entryId))).toStrictEqual([]);
  });

  it("does not tell them again when a second request finds it already hidden", async () => {
    const entryId = await sharedEntry();
    const author = await authorOf(entryId);
    await file(entryLink(entryId));
    await core()
      .update(notifications)
      .set({ read: true })
      .where(eq(notifications.userId, author));
    await file(`${entryLink(entryId)}/`);
    expect(await hideNoticesFor(author)).toMatchObject([{ read: true }]);
  });

  it("tells nobody for a link that is not ours", async () => {
    await sharedEntry();
    await file("https://elsewhere.example/img");
    expect(await core().select().from(notifications)).toStrictEqual([]);
  });
});
