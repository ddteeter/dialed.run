import { beforeEach, describe, expect, it } from "vitest";

import { account } from "../../src/db/schema-auth";
import {
  notificationPreferences,
  stravaConnections,
} from "../../src/db/schema-core";
import { isEmailWanted, notificationSettings } from "../../src/modules/email";
import {
  maskedAddress,
  oneClickUnsubscribe,
  readByLink,
  switchByLink,
} from "../../src/modules/email/landing";
import { unsubscribeUrl } from "../../src/modules/email/unsubscribe";
import {
  accountPage,
  accountView,
  ownAddressView,
} from "../../src/modules/account/account-view";
import { acceptanceOf } from "../../src/modules/account/terms-acceptance";
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

describe("readByLink (opening the link, D-64)", () => {
  it("names the address, masked, and asks, and changes no preference", async () => {
    const { userId, email } = await seedUser();
    const search = await signedSearch(userId);

    expect(await readByLink(db, SECRET, search)).toStrictEqual({
      state: "ask",
      kind: "run_reminder",
      email: maskedAddress(email),
    });
    expect(await isEmailWanted(db, userId, "run_reminder")).toBe(true);
    expect(await db.select().from(notificationPreferences)).toStrictEqual([]);
  });

  it("leaves a runner subscribed when a scanner opens the link and nothing follows", async () => {
    const { userId } = await seedUser();
    const search = await signedSearch(userId);
    // A gateway prefetching every link, several times over.
    for (let n = 0; n < 3; n += 1) await readByLink(db, SECRET, search);
    expect(await isEmailWanted(db, userId, "run_reminder")).toBe(true);
  });

  it("shows the done state on a second visit, once the kind is off", async () => {
    const { userId, email } = await seedUser();
    const search = await signedSearch(userId);
    await switchByLink(db, SECRET, search, false);
    expect(await readByLink(db, SECRET, search)).toStrictEqual({
      state: "off",
      kind: "run_reminder",
      email: maskedAddress(email),
    });
  });

  it("unsubscribes only on the button's POST", async () => {
    const { userId } = await seedUser();
    const search = await signedSearch(userId);
    await readByLink(db, SECRET, search);
    expect(await isEmailWanted(db, userId, "run_reminder")).toBe(true);
    await switchByLink(db, SECRET, search, false);
    expect(await isEmailWanted(db, userId, "run_reminder")).toBe(false);
  });

  it("says a tampered link, a gone account or a missing secret does not work", async () => {
    const { userId } = await seedUser();
    const search = await signedSearch(userId);
    const invalid = { state: "invalid" };
    expect(
      await readByLink(db, SECRET, { ...search, s: "tampered" }),
    ).toStrictEqual(invalid);
    const gone = await signedSearch(newUlid());
    expect(await readByLink(db, SECRET, gone)).toStrictEqual(invalid);
    // Fail closed: with no secret, even a good link is refused.
    for (const secret of [undefined, ""]) {
      expect(await readByLink(db, secret, search)).toStrictEqual(invalid);
      expect(await switchByLink(db, secret, search, false)).toStrictEqual(
        invalid,
      );
    }
    expect(await isEmailWanted(db, userId, "run_reminder")).toBe(true);
  });
});

describe("maskedAddress", () => {
  it("keeps two characters of the local part and the whole domain", () => {
    expect(maskedAddress("maya@example.com")).toBe("ma•••@example.com");
    expect(maskedAddress("m@example.com")).toBe("m•••@example.com");
    // The domain is split at the last @, as an address is.
    expect(maskedAddress('"a@b"@example.com')).toBe('"a•••@example.com');
  });
});

describe("switchByLink", () => {
  it("turns the reminder off, and back on to the question again", async () => {
    const { userId, email } = await seedUser();
    const search = await signedSearch(userId);

    expect(await switchByLink(db, SECRET, search, false)).toStrictEqual({
      state: "off",
      kind: "run_reminder",
      email: maskedAddress(email),
    });
    expect(await isEmailWanted(db, userId, "run_reminder")).toBe(false);

    expect(await switchByLink(db, SECRET, search, true)).toStrictEqual({
      state: "ask",
      kind: "run_reminder",
      email: maskedAddress(email),
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
      dataExport: { state: "idle" },
      isStravaConnected: false,
      // The shipped terms are unpublished, so nobody is behind (D-93).
      isBehindOnTerms: false,
    });
    // Strava's row on the read-only page (round 30 #4a).
    await db.insert(stravaConnections).values({
      userId: google.userId,
      athleteId: "athlete-1",
      refreshToken: "refresh-1",
    });
    const connected = await accountPage(db, google.userId);
    expect(connected.isStravaConnected).toBe(true);
    // Once terms are published, a runner with no acceptance is behind, and
    // the page is read only (round 30 #4a); accepted, it is not.
    const published = await accountPage(db, google.userId, 1_800_000_000, 1);
    expect(published.isBehindOnTerms).toBe(true);
    await acceptanceOf(db, google.userId, 1, 1_800_000_000, "page");
    const accepted = await accountPage(db, google.userId, 1_800_000_000, 1);
    expect(accepted.isBehindOnTerms).toBe(false);
    await expect(accountPage(db, "gone")).rejects.toThrow(
      "signed in to an account that is gone",
    );

    // The address alone, for the screens that only show the nag and the
    // confirm sheet: no password question asked.
    expect(await ownAddressView(db, withPassword.userId)).toStrictEqual({
      email: withPassword.email,
      isVerified: false,
    });
    expect(await ownAddressView(db, google.userId)).toStrictEqual({
      email: google.email,
      isVerified: true,
    });
    await expect(ownAddressView(db, "gone")).rejects.toThrow(
      "signed in to an account that is gone",
    );
  });
});
