import { beforeEach, describe, expect, it } from "vitest";

import { account } from "../../src/db/schema-auth";
import { notificationPreferences } from "../../src/db/schema-core";
import { isEmailWanted, notificationSettings } from "../../src/modules/email";
import {
  oneClickUnsubscribe,
  switchByLink,
} from "../../src/modules/email/landing";
import { unsubscribeUrl } from "../../src/modules/email/unsubscribe";
import {
  accountPage,
  accountView,
} from "../../src/modules/account/account-view";
import { newUlid } from "../../src/lib/ids";
import { core, ORIGIN, SECRET, seedUser } from "./helpers";

/**
 * The unsubscribe link opened, and one-click (round 26 #19; RFC 8058):
 * no session, the signature is the permission; and Settings ›
 * Notifications' read.
 */

const db = core();

beforeEach(async () => {
  await db.delete(notificationPreferences);
});

async function signedSearch(userId: string): Promise<Record<string, string>> {
  const url = new URL(
    await unsubscribeUrl(ORIGIN, SECRET, userId, "run_reminder"),
  );
  return Object.fromEntries(url.searchParams);
}

describe("switchByLink", () => {
  it("turns the reminder off on open, names the address, and back on again", async () => {
    const { userId, email } = await seedUser();
    const search = await signedSearch(userId);

    expect(await switchByLink(db, SECRET, search, false)).toStrictEqual({
      state: "off",
      kind: "run_reminder",
      email,
    });
    expect(await isEmailWanted(db, userId, "run_reminder")).toBe(false);

    expect(await switchByLink(db, SECRET, search, true)).toStrictEqual({
      state: "on",
      kind: "run_reminder",
      email,
    });
    expect(await isEmailWanted(db, userId, "run_reminder")).toBe(true);
  });

  it("changes nothing for a tampered link, or one for an account that is gone", async () => {
    const { userId } = await seedUser();
    const search = await signedSearch(userId);
    expect(
      await switchByLink(db, SECRET, { ...search, s: "tampered" }, false),
    ).toStrictEqual({ state: "invalid" });
    expect(await isEmailWanted(db, userId, "run_reminder")).toBe(true);

    const gone = await signedSearch("gone");
    expect(await switchByLink(db, SECRET, gone, false)).toStrictEqual({
      state: "invalid",
    });
    expect(await db.select().from(notificationPreferences)).toHaveLength(0);
  });
});

describe("oneClickUnsubscribe", () => {
  it("answers a mail client's POST with a 2xx and turns the kind off", async () => {
    const { userId } = await seedUser();
    const url = await unsubscribeUrl(ORIGIN, SECRET, userId, "run_reminder");
    const response = await oneClickUnsubscribe(
      db,
      SECRET,
      new Request(url, {
        method: "POST",
        body: "List-Unsubscribe=One-Click",
      }),
    );
    expect(response.status).toBe(200);
    expect(await isEmailWanted(db, userId, "run_reminder")).toBe(false);
  });

  it("refuses a bad link with a 400", async () => {
    const response = await oneClickUnsubscribe(
      db,
      SECRET,
      new Request(`${ORIGIN}/account/unsubscribe?u=x&k=run_reminder&s=bad`, {
        method: "POST",
      }),
    );
    expect(response.status).toBe(400);
  });
});

describe("notificationSettings", () => {
  it("is the address emails go to and the reminder's switch", async () => {
    const { userId, email } = await seedUser();
    expect(await notificationSettings(db, userId)).toStrictEqual({
      email,
      runReminder: true,
    });
    const search = await signedSearch(userId);
    await switchByLink(db, SECRET, search, false);
    expect(await notificationSettings(db, userId)).toStrictEqual({
      email,
      runReminder: false,
    });
    expect(await notificationSettings(db, "gone")).toStrictEqual({
      email: "",
      runReminder: true,
    });
  });
});

describe("the account's settings read", () => {
  it("says whether there is a password to change", async () => {
    const withPassword = await seedUser({ isVerified: false });
    const now = new Date();
    await db.insert(account).values({
      id: newUlid(),
      issuer: "local",
      accountId: withPassword.userId,
      providerId: "credential",
      userId: withPassword.userId,
      password: "hash",
      createdAt: now,
      updatedAt: now,
    });
    const google = await seedUser();
    await db.insert(account).values({
      id: newUlid(),
      issuer: "https://accounts.google.com",
      accountId: "g-1",
      providerId: "google",
      userId: google.userId,
      createdAt: now,
      updatedAt: now,
    });

    expect(await accountView(db, withPassword.userId)).toStrictEqual({
      email: withPassword.email,
      isVerified: false,
      hasPassword: true,
    });
    expect(await accountView(db, google.userId)).toStrictEqual({
      email: google.email,
      isVerified: true,
      hasPassword: false,
    });
    expect(await accountView(db, undefined)).toBeUndefined();
    expect(await accountView(db, "gone")).toBeUndefined();

    expect(await accountPage(db, google.userId)).toStrictEqual({
      account: { email: google.email, isVerified: true, hasPassword: false },
      username: undefined,
      notifications: { email: google.email, runReminder: true },
    });
    await expect(accountPage(db, "gone")).rejects.toThrow(
      "signed in to an account that is gone",
    );
  });
});
