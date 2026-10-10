import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  moderationActions,
  outbox,
  outfitEntries,
  takedownRequests,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { readOutboxRow } from "../../src/lib/sql/outbox";
import { decideRemovalRequest } from "../../src/modules/feed/removal-requests";

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
