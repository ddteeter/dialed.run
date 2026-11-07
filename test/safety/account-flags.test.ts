import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { user } from "../../src/db/schema-auth";
import {
  accountDeletions,
  entryPhotos,
  moderationActions,
} from "../../src/db/schema-core";
import { env } from "../../src/env";
import { entryPhotoKeyFor } from "../../src/lib/entry-photo-key";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { listAccounts } from "../../src/modules/account";
import { moderateContent } from "../../src/modules/feed/moderation";
import {
  flaggedAtOf,
  flaggedCountOf,
  keepAccount,
} from "../../src/modules/safety/account-flags";
import { banUser, unbanUser } from "../../src/modules/safety/bans";
import { removalStatements } from "../../src/modules/safety/contracts";
import type { ModerationAction } from "../../src/modules/safety/moderation-actions";
import {
  deskRunners,
  runnersWhere,
  type RunnersFilter,
} from "../../src/modules/safety/runners";
import { noPurge } from "../purge-spy";
import { makeEntry, makeRun, makeUser, resetSafetyTables } from "./helpers";

/**
 * D-161 (1): an upheld intimate-image removal flags the poster's account
 * on D8 until an operator decides (Keep, Close or Reopen). Derived from
 * `moderation_actions`, so these tests write what the Desk writes.
 */

function core() {
  return drizzle(env.DIALED_CORE);
}

async function runner(email: string): Promise<string> {
  const userId = await makeUser({
    username: email.slice(0, email.indexOf("@")),
  });
  await core()
    .insert(user)
    .values({
      id: userId,
      name: userId,
      email,
      emailVerified: true,
      createdAt: new Date(1000 * 1000),
      updatedAt: new Date(1000 * 1000),
    });
  return userId;
}

/**
An audit row as the Desk writes one, at `createdAt`.
*/
async function recorded(
  ownerId: string,
  action: ModerationAction,
  reason: string,
  createdAt: number,
): Promise<void> {
  const isAccount = ["ban", "unban", "keep"].includes(action);
  await core()
    .insert(moderationActions)
    .values({
      id: newUlid(),
      actorId: "op",
      action,
      subjectType: isAccount ? "profile" : "photo",
      subjectId: isAccount ? ownerId : newUlid(),
      subjectOwnerId: ownerId,
      reason,
      createdAt,
    });
}

const INTIMATE = removalStatements.intimate;

function quiet(): void {
  // No path here reports to Sentry.
}

async function flaggedAt(userId: string): Promise<number | undefined> {
  const flags = await flaggedAtOf(core(), [userId]);
  return flags.get(userId);
}

async function flaggedCount(): Promise<number> {
  const [row] = await flaggedCountOf(core());
  return row?.rows ?? 0;
}

async function listed(filter: RunnersFilter["filter"]) {
  const accounts = await listAccounts(core(), {
    query: undefined,
    only: runnersWhere(filter),
  });
  return deskRunners(core(), accounts);
}

beforeEach(async () => {
  await resetSafetyTables();
  await core().delete(accountDeletions);
  await core().delete(user);
});

describe("an intimate-image removal flags its poster (D-161 1)", () => {
  it("flags the owner of an intimate removal, at its time", async () => {
    const poster = await runner("poster@example.com");
    await recorded(poster, "remove", INTIMATE, 500);

    expect(await flaggedAt(poster)).toBe(500);
    expect(await flaggedCount()).toBe(1);
  });

  it("flags a takedown, and one with the Desk's notice after the words", async () => {
    const one = await runner("one@example.com");
    const two = await runner("two@example.com");
    await recorded(one, "takedown", INTIMATE, 500);
    await recorded(two, "remove", `${INTIMATE} — from a takedown request`, 600);

    expect(await flaggedAt(one)).toBe(500);
    expect(await flaggedAt(two)).toBe(600);
    expect(await flaggedCount()).toBe(2);
  });

  it("flags nobody for another reason, or for a quarantine", async () => {
    const poster = await runner("poster@example.com");
    await recorded(poster, "remove", removalStatements.explicit, 500);
    await recorded(poster, "quarantine", INTIMATE, 500);
    await recorded(poster, "remove", `the photo: ${INTIMATE}`, 500);

    expect(await flaggedAt(poster)).toBeUndefined();
    expect(await flaggedCount()).toBe(0);
  });

  it("names the latest open removal, and counts the account once", async () => {
    const poster = await runner("poster@example.com");
    await recorded(poster, "remove", INTIMATE, 500);
    await recorded(poster, "remove", INTIMATE, 700);

    expect(await flaggedAt(poster)).toBe(700);
    expect(await flaggedCount()).toBe(1);
  });

  it.each(["keep", "ban", "unban"] as const)(
    "is cleared by a %s at or after the removal",
    async (action) => {
      const poster = await runner("poster@example.com");
      await recorded(poster, "remove", INTIMATE, 500);
      await recorded(poster, action, "decided", 500);

      expect(await flaggedAt(poster)).toBeUndefined();
      expect(await flaggedCount()).toBe(0);
    },
  );

  it("is not cleared by a decision from before the removal, or a rename", async () => {
    const poster = await runner("poster@example.com");
    await recorded(poster, "keep", "decided", 400);
    await recorded(poster, "rename", "Offensive or sexual", 600);
    await recorded(poster, "remove", INTIMATE, 500);

    expect(await flaggedAt(poster)).toBe(500);
  });

  it("is not cleared by a decision on someone else's account", async () => {
    const poster = await runner("poster@example.com");
    const other = await runner("other@example.com");
    await recorded(poster, "remove", INTIMATE, 500);
    await recorded(other, "keep", "decided", 600);

    expect(await flaggedAt(poster)).toBe(500);
  });

  it("flags again on a later removal after a Keep", async () => {
    const poster = await runner("poster@example.com");
    await recorded(poster, "remove", INTIMATE, 500);
    await keepAccount(core(), poster, "op");
    expect(await flaggedAt(poster)).toBeUndefined();

    const later = nowSeconds() + 60;
    await recorded(poster, "remove", INTIMATE, later);
    expect(await flaggedAt(poster)).toBe(later);
  });

  it("records Keep account as the operator's decision on the profile", async () => {
    const poster = await runner("poster@example.com");
    await keepAccount(core(), poster, "op");

    const rows = await core().select().from(moderationActions);
    expect(rows).toStrictEqual([
      expect.objectContaining({
        actorId: "op",
        action: "keep",
        subjectType: "profile",
        subjectId: poster,
        subjectOwnerId: poster,
        reason: "Kept after an intimate-image removal",
      }),
    ]);
  });

  it("answers nothing for no accounts named", async () => {
    expect([...(await flaggedAtOf(core(), []))]).toStrictEqual([]);
  });
});

/**
A photo on a shared kit of `author`'s, stored as an upload stores it.
*/
async function postedPhoto(author: string) {
  const runId = await makeRun({ userId: author });
  const entryId = await makeEntry({
    userId: author,
    runId,
    audience: "runners",
  });
  const photoId = newUlid();
  const key = entryPhotoKeyFor(author, entryId, photoId);
  await env.MEDIA.put(key, new Uint8Array([1, 2, 3]));
  await core()
    .insert(entryPhotos)
    .values({ id: photoId, entryId, photoKey: key, position: 0 });
  return photoId;
}
describe("the flag from a real Remove (feed's moderateContent)", () => {
  it("flags the poster of a photo removed as intimate, and not as spam", async () => {
    const poster = await runner("poster@example.com");
    const spammer = await runner("spammer@example.com");
    for (const [author, reason] of [
      [poster, "intimate"],
      [spammer, "spam"],
    ] as const) {
      await moderateContent(
        core(),
        {
          actorId: "op",
          action: "remove",
          subjectType: "photo",
          subjectId: await postedPhoto(author),
          reason,
        },
        quiet,
      );
    }

    expect(await flaggedAt(poster)).toBeTypeOf("number");
    expect(await flaggedAt(spammer)).toBeUndefined();
  });
});

describe("D8 Runners: state and flag (PR#126-1, D-161 1)", () => {
  it("reads PENDING DELETE from a deletion request, and CLOSED over it", async () => {
    const leaving = await runner("leaving@example.com");
    const closed = await runner("closed@example.com");
    const active = await runner("active@example.com");
    await core()
      .insert(accountDeletions)
      .values([
        { userId: leaving, requestedAt: 1, purgeAfter: 2 },
        { userId: closed, requestedAt: 1, purgeAfter: 2 },
      ]);
    await banUser(
      { userId: closed, reason: "Spam", rule: "spam", bannedBy: "op" },
      noPurge,
    );

    const rows = await listed("all");
    const states = new Map(rows.map((row) => [row.userId, row.state]));
    expect(states).toStrictEqual(
      new Map([
        [leaving, "PENDING DELETE"],
        [closed, "CLOSED"],
        [active, "ACTIVE"],
      ]),
    );
  });

  it("carries the flag on the row, and filters to flagged accounts", async () => {
    const poster = await runner("poster@example.com");
    const kept = await runner("kept@example.com");
    await runner("plain@example.com");
    await recorded(poster, "remove", INTIMATE, 500);
    await recorded(kept, "remove", INTIMATE, 500);
    await recorded(kept, "keep", "decided", 600);

    const all = await listed("all");
    expect(
      new Map(all.map((row) => [row.userId, row.flaggedAt])),
    ).toStrictEqual(
      new Map([
        [poster, 500],
        [kept, undefined],
        [
          all.find((row) => row.email === "plain@example.com")?.userId,
          undefined,
        ],
      ]),
    );
    const flagged = await listed("flagged");
    expect(flagged.map((row) => row.userId)).toStrictEqual([poster]);
  });

  it("clears the flag through the Desk's own unban", async () => {
    const poster = await runner("poster@example.com");
    await recorded(poster, "remove", INTIMATE, 500);
    await banUser(
      { userId: poster, reason: "Serious", rule: "explicit", bannedBy: "op" },
      noPurge,
    );
    await unbanUser(poster, "op");

    expect(await listed("flagged")).toStrictEqual([]);
  });
});

describe("the flag's reads (D-161 1)", () => {
  it("looks a removal's decision up through moderation_actions_subject, as account_decision", async () => {
    const { sql, params } = flaggedCountOf(core()).toSQL();
    const plan = await env.DIALED_CORE.prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .bind(...params)
      .all<{ detail: string }>();
    // Today's count is a scan (the doc comment says so); each removal's
    // decision is a probe of the profile's audit rows.
    expect(plan.results.map((row) => row.detail)).toStrictEqual([
      "SCAN moderation_actions USING INDEX moderation_actions_owner",
      "CORRELATED SCALAR SUBQUERY 1",
      "SEARCH account_decision USING INDEX moderation_actions_subject (subject_type=? AND subject_id=?)",
    ]);
  });
});
