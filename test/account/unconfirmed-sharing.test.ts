import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { user } from "../../src/db/schema-auth";
import { outfitEntries } from "../../src/db/schema-core";
import { isUnconfirmed, isVerified } from "../../src/modules/account";
import { emailConfirmationOf } from "../../src/modules/account/email-links";
import { attachKit, submitVerdict } from "../../src/modules/feed/entries";
import {
  audienceAsChosen,
  defaultAudienceFor,
} from "../../src/modules/feed/share-default";
import { core } from "../email/helpers";
import {
  entryAudienceColumns,
  makeRun,
  makeUser,
  resetTables,
} from "../feed/helpers";
import type { Audience } from "../../src/lib/contracts";

/**
 * Decision D-50: an unconfirmed account's entries save private, and
 * confirming restores the runner's own default. No queued-share state
 * (round 26 #11's was not adopted): an entry is public or private.
 */

const db = core();

beforeEach(async () => {
  await resetTables();
});

/**
A runner as sign-up leaves them: a profile and a `user` row.
*/
async function runner(
  options: Readonly<{ isVerified: boolean; defaultAudience?: Audience }>,
): Promise<string> {
  const userId = await makeUser(
    options.defaultAudience === undefined
      ? undefined
      : { defaultAudience: options.defaultAudience },
  );
  await db.insert(user).values({
    id: userId,
    name: "",
    email: `${userId.toLowerCase()}@example.test`,
    emailVerified: options.isVerified,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return userId;
}

async function confirm(userId: string): Promise<void> {
  await db.update(user).set({ emailVerified: true }).where(eq(user.id, userId));
}

/**
Both stored columns, which every write keeps in step until C1 (design 131).
*/
async function storedAudience(
  entryId: string,
): Promise<{ audience: Audience; legacyIsPublic: boolean } | undefined> {
  const [row] = await db
    .select({
      audience: outfitEntries.audience,
      legacyIsPublic: outfitEntries.legacyIsPublic,
    })
    .from(outfitEntries)
    .where(eq(outfitEntries.id, entryId));
  return row;
}

const SHARED = entryAudienceColumns("runners");
const PRIVATE = entryAudienceColumns("private");

describe("the confirmation gates", () => {
  it("reads one fact three ways: confirmed, unconfirmed, and no account", async () => {
    const confirmed = await runner({ isVerified: true });
    const unconfirmed = await runner({ isVerified: false });

    expect(await emailConfirmationOf(db, confirmed)).toBe(true);
    expect(await emailConfirmationOf(db, unconfirmed)).toBe(false);
    expect(await emailConfirmationOf(db, "no-account")).toBeUndefined();

    // Useful, report, change and reset want a confirmed address; an
    // account that is not there has none.
    expect(await isVerified(db, confirmed)).toBe(true);
    expect(await isVerified(db, unconfirmed)).toBe(false);
    expect(await isVerified(db, "no-account")).toBe(false);

    // Sharing holds back only an account that exists and is unconfirmed.
    expect(await isUnconfirmed(db, confirmed)).toBe(false);
    expect(await isUnconfirmed(db, unconfirmed)).toBe(true);
    expect(await isUnconfirmed(db, "no-account")).toBe(false);
  });
});

describe("an unconfirmed runner's entries (D-50)", () => {
  it("start private whatever the default, and start at the default once confirmed", async () => {
    const userId = await runner({
      isVerified: false,
      defaultAudience: "runners",
    });
    expect(await defaultAudienceFor(db, userId)).toBe("private");

    const entryId = await attachKit({
      userId,
      runId: await makeRun({ userId }),
      itemIds: [],
    });
    expect(await storedAudience(entryId)).toEqual(PRIVATE);

    await confirm(userId);
    expect(await defaultAudienceFor(db, userId)).toBe("runners");
    const after = await attachKit({
      userId,
      runId: await makeRun({ userId }),
      itemIds: [],
    });
    expect(await storedAudience(after)).toEqual(SHARED);
    // Confirming changes nothing stored: the earlier entry stays private.
    expect(await storedAudience(entryId)).toEqual(PRIVATE);
  });

  it("stay private when a verdict is saved with the share toggle on", async () => {
    const userId = await runner({ isVerified: false });
    const entryId = await attachKit({
      userId,
      runId: await makeRun({ userId }),
      itemIds: [],
    });

    await submitVerdict({
      userId,
      entryId,
      verdict: 0,
      audience: "runners",
      tags: [],
      itemFlags: [],
    });
    expect(await storedAudience(entryId)).toEqual(PRIVATE);

    await confirm(userId);
    await submitVerdict({
      userId,
      entryId,
      verdict: 0,
      audience: "runners",
      tags: [],
      itemFlags: [],
    });
    expect(await storedAudience(entryId)).toEqual(SHARED);
  });

  it("keep a confirmed runner's own private choice and opt-out", async () => {
    const quiet = await runner({
      isVerified: true,
      defaultAudience: "private",
    });
    expect(await defaultAudienceFor(db, quiet)).toBe("private");
    expect(await audienceAsChosen(db, quiet, "private")).toBe("private");
    expect(await audienceAsChosen(db, quiet, "runners")).toBe("runners");
  });
});
