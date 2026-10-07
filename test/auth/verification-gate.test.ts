import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import { accountDeletions } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { acceptanceOf } from "../../src/modules/account/terms-acceptance";
import { sessionFromRequest } from "../../src/modules/auth/session";
import {
  confirmedUserId,
  confirmedViewerId,
} from "../../src/modules/auth/terms-gate";
import { addAccount } from "../feed/helpers";

/**
 * `verifiedUserId`'s whole decision (design 133, decision D-113): the
 * terms gate, and then a confirmed address — refused in that order, so a
 * runner behind on the terms is sent to the terms prompt before anything
 * says "confirm your email".
 */
const db = drizzle(env.DIALED_CORE);

/**
The terms' version in these tests, as if published.
*/
const PUBLISHED = 3;

const UNCONFIRMED = {
  // Written out: the client tells this refusal apart by these words.
  code: "EMAIL_UNCONFIRMED",
  message: "Confirm your email first.",
  name: "EmailUnconfirmedError",
};

function sessionOf(userId: string) {
  return { user: { id: userId } };
}

/**
A runner with an account, confirmed or not, who accepted the current terms.
*/
async function runner(isConfirmed: boolean): Promise<string> {
  const userId = newUlid();
  await addAccount(userId, isConfirmed);
  await acceptanceOf(db, userId, PUBLISHED, 100, "page");
  return userId;
}

describe("confirmedUserId — verifiedUserId's whole decision", () => {
  it("lets a confirmed runner through, as their own id", async () => {
    const userId = await runner(true);
    await expect(
      confirmedUserId(db, sessionOf(userId), PUBLISHED),
    ).resolves.toBe(userId);
  });

  it("refuses an unconfirmed runner with the unconfirmed signal", async () => {
    const userId = await runner(false);
    await expect(
      confirmedUserId(db, sessionOf(userId), PUBLISHED),
    ).rejects.toMatchObject(UNCONFIRMED);
  });

  it("refuses a runner with no account at all, who is gone", async () => {
    const userId = newUlid();
    await acceptanceOf(db, userId, PUBLISHED, 100, "page");
    await expect(
      confirmedUserId(db, sessionOf(userId), PUBLISHED),
    ).rejects.toMatchObject(UNCONFIRMED);
  });

  it("refuses nobody signed in as the unauthenticated signal", async () => {
    const nobody = await sessionFromRequest(
      new Request("https://dialed.run/feed"),
    );
    await expect(confirmedUserId(db, nobody, PUBLISHED)).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
  });

  it("sends a runner behind on the terms to the terms first, confirmed or not", async () => {
    for (const isConfirmed of [false, true]) {
      const userId = newUlid();
      await addAccount(userId, isConfirmed);
      await expect(
        confirmedUserId(db, sessionOf(userId), PUBLISHED),
      ).rejects.toMatchObject({ code: "TERMS_NOT_ACCEPTED" });
    }
  });

  it("refuses an account set to be deleted ahead of either", async () => {
    const userId = await runner(false);
    await db
      .insert(accountDeletions)
      .values({ userId, requestedAt: 1, purgeAfter: 2 });
    await expect(
      confirmedUserId(db, sessionOf(userId), PUBLISHED),
    ).rejects.toMatchObject({ code: "ACCOUNT_LEAVING" });
  });

  it("asks nothing of the terms while none are published, and still asks the address", async () => {
    // No version: the shipped draft, which is unpublished (D-93).
    const confirmed = newUlid();
    const unconfirmed = newUlid();
    await addAccount(confirmed, true);
    await addAccount(unconfirmed, false);
    await expect(confirmedUserId(db, sessionOf(confirmed))).resolves.toBe(
      confirmed,
    );
    await expect(
      confirmedUserId(db, sessionOf(unconfirmed)),
    ).rejects.toMatchObject(UNCONFIRMED);
  });

  it("reads only the runner's own account", async () => {
    // Somebody else confirmed is not this runner confirmed.
    await runner(true);
    const userId = await runner(false);
    await expect(
      confirmedUserId(db, sessionOf(userId), PUBLISHED),
    ).rejects.toMatchObject(UNCONFIRMED);
  });
});

describe("confirmedViewerId — the Desk's door, asked as confirmedUserId asks", () => {
  it("is a confirmed runner's own id", async () => {
    const userId = await runner(true);
    await expect(
      confirmedViewerId(db, sessionOf(userId), PUBLISHED),
    ).resolves.toBe(userId);
  });

  it("is nobody for anyone confirmedUserId refuses, signed out included", async () => {
    const unconfirmed = await runner(false);
    const behind = newUlid();
    await addAccount(behind, true);
    const leaving = await runner(true);
    await db
      .insert(accountDeletions)
      .values({ userId: leaving, requestedAt: 1, purgeAfter: 2 });
    const nobody = await sessionFromRequest(
      new Request("https://dialed.run/desk"),
    );

    for (const session of [
      sessionOf(unconfirmed),
      sessionOf(behind),
      sessionOf(leaving),
      nobody,
    ]) {
      await expect(
        confirmedViewerId(db, session, PUBLISHED),
      ).resolves.toBeUndefined();
    }
  });

  it("asks nothing of the terms while none are published", async () => {
    const userId = newUlid();
    await addAccount(userId, true);
    await expect(confirmedViewerId(db, sessionOf(userId))).resolves.toBe(
      userId,
    );
  });
});
