import { eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  accountDeletions,
  emailVerifications,
  outbox,
  userProfiles,
} from "../../src/db/schema-core";
import { DELETION_GRACE_S, DELETION_LINK_TTL_S } from "../../src/lib/contracts";
import { proseDayLabel } from "../../src/lib/dates";
import {
  ageClosure,
  confirmDeletionLink,
  deletionLinksOf,
  deletionLinkUrl,
  readDeletionLanding,
  reopenDeletionWrites,
  reopenHeldBy,
  sendDeletionLink,
  type DeletionLinkEffects,
} from "../../src/modules/account/data/deletion-link";
import { issueEmailLink } from "../../src/modules/account/verification/email-links";
import { core, fakeMail, ORIGIN, owedTo, seedUser } from "../email/helpers";

/**
 * Deleting a closed account (design 289; round 64 #372–374) on real D1:
 * the Desk's link, one at a time, to the account's own address; its page,
 * which spends nothing until the button; the purge scheduled a week on,
 * once; the under-18 closure; and what Reopen undoes.
 */

const db = core();
const NOW = 1_800_000_000;
const DAY = (at: number) => proseDayLabel(at, "UTC");

beforeEach(async () => {
  await db.batch([
    db.delete(emailVerifications),
    db.delete(accountDeletions),
    db.delete(outbox),
    // Handles are unique, and these tests name the same one.
    db.delete(userProfiles),
  ]);
});

/**
A closed account: Better Auth's row, and a profile the Desk banned.
*/
async function closedRunner(
  options: Readonly<{ handle?: string; timeZone?: string }> = {},
): Promise<{ userId: string; email: string }> {
  const seeded = await seedUser();
  await db.insert(userProfiles).values({
    userId: seeded.userId,
    ...(options.handle !== undefined && { username: options.handle }),
    ...(options.timeZone !== undefined && { timeZone: options.timeZone }),
    bannedAt: NOW - 60,
    banReason: "Spam",
  });
  return seeded;
}

/**
The token in a sent deletion-link email's button.
*/
function tokenIn(message: EmailMessageBuilder | undefined): string {
  const href = /href="([^"]+)"/u.exec(message?.html ?? "")?.[1] ?? "";
  return new URL(href.replaceAll("&amp;", "&")).searchParams.get("token") ?? "";
}

async function linkRows() {
  const rows = await db
    .select({
      userId: emailVerifications.userId,
      purpose: emailVerifications.purpose,
      email: emailVerifications.email,
      expiresAt: emailVerifications.expiresAt,
      usedAt: emailVerifications.usedAt,
    })
    .from(emailVerifications);
  return rows.map((row) => ({ ...row, usedAt: row.usedAt ?? undefined }));
}

/**
The used stamp on the one link there is.
*/
async function usedAtOfLink(): Promise<number | undefined> {
  const [row] = await linkRows();
  return row?.usedAt;
}

/**
Writes handed back for a batch, run as one.
*/
async function run(writes: readonly BatchItem<"sqlite">[]): Promise<void> {
  const [first, ...rest] = writes;
  if (first !== undefined) await db.batch([first, ...rest]);
}

async function deletionRows() {
  const rows = await db
    .select({
      userId: accountDeletions.userId,
      requestedAt: accountDeletions.requestedAt,
      purgeAfter: accountDeletions.purgeAfter,
      cause: accountDeletions.cause,
      closedUnder18At: accountDeletions.closedUnder18At,
    })
    .from(accountDeletions);
  return rows.map((row) => ({
    ...row,
    closedUnder18At: row.closedUnder18At ?? undefined,
  }));
}

function effectsFor(mail: ReturnType<typeof fakeMail>) {
  const { owed, settled } = owedTo(mail);
  const disconnectStrava = vi.fn<DeletionLinkEffects["disconnectStrava"]>();
  disconnectStrava.mockResolvedValue();
  const report = vi.fn<DeletionLinkEffects["report"]>();
  const effects: DeletionLinkEffects = { ...owed, report, disconnectStrava };
  return { effects, settled, disconnectStrava, report };
}

async function sentToken(userId: string): Promise<string> {
  const mail = fakeMail();
  await sendDeletionLink(db, userId, mail, NOW);
  return tokenIn(mail.sent[0]);
}

describe("deletionLinkUrl", () => {
  it("opens the link's page with the token in its search", () => {
    expect(deletionLinkUrl(ORIGIN, "delete.u.s+/")).toBe(
      `${ORIGIN}/account/deletion?token=delete.u.s%2B%2F`,
    );
  });
});

describe("sendDeletionLink (round 64 #372)", () => {
  it("sends a closed account one link, to its own address, until a week on", async () => {
    const { userId, email } = await closedRunner({ handle: "runner_1290" });
    const mail = fakeMail();
    expect(await sendDeletionLink(db, userId, mail, NOW)).toStrictEqual({
      status: "sent",
      expiresAt: NOW + DELETION_LINK_TTL_S,
    });
    expect(await linkRows()).toStrictEqual([
      {
        userId,
        purpose: "delete",
        email,
        expiresAt: NOW + DELETION_LINK_TTL_S,
        usedAt: undefined,
      },
    ]);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]?.to).toBe(email);
    expect(mail.sent[0]?.subject).toBe("Delete your closed dialed.run account");
    expect(mail.sent[0]?.text).toContain(
      "Your account @runner_1290 is closed.",
    );
    expect(mail.sent[0]?.text).toContain(
      `The link works once, until ${DAY(NOW + DELETION_LINK_TTL_S)}.`,
    );
    expect(tokenIn(mail.sent[0]).startsWith(`delete.${userId}.`)).toBe(true);
    // Sent now, never owed: no outbox row holds the live link.
    expect(await db.select().from(outbox)).toStrictEqual([]);
  });

  it("names the day on the runner's home zone (owner, 2026-11-27)", async () => {
    const { userId } = await closedRunner({ timeZone: "Pacific/Honolulu" });
    const at = Date.UTC(2027, 0, 8, 8) / 1000 - DELETION_LINK_TTL_S;
    const mail = fakeMail();
    await sendDeletionLink(db, userId, mail, at);
    expect(mail.sent[0]?.text).toContain("until Thu, Jan 7.");
  });

  it("says the account without a handle for a runner who has none", async () => {
    const { userId } = await closedRunner();
    const mail = fakeMail();
    await sendDeletionLink(db, userId, mail, NOW);
    expect(mail.sent[0]?.text).toContain("Your account is closed.");
  });

  it("sends nothing while a link is live, and a fresh one once it ran out", async () => {
    const { userId } = await closedRunner();
    const mail = fakeMail();
    await sendDeletionLink(db, userId, mail, NOW);
    expect(
      await sendDeletionLink(db, userId, mail, NOW + DELETION_LINK_TTL_S - 1),
    ).toStrictEqual({ status: "refused" });
    expect(mail.sent).toHaveLength(1);

    const later = NOW + DELETION_LINK_TTL_S;
    expect(await sendDeletionLink(db, userId, mail, later)).toStrictEqual({
      status: "sent",
      expiresAt: later + DELETION_LINK_TTL_S,
    });
    expect(mail.sent).toHaveLength(2);
    // The old link stopped working: the row holds the new one.
    expect(
      await readDeletionLanding(db, tokenIn(mail.sent[0]), later),
    ).toStrictEqual({ state: "expired" });
    expect(
      await readDeletionLanding(db, tokenIn(mail.sent[1]), later),
    ).toMatchObject({ state: "ask" });
  });

  it("refuses an open account, an account that is gone, and one already leaving", async () => {
    const open = await seedUser();
    const leaving = await closedRunner();
    await db.insert(accountDeletions).values({
      userId: leaving.userId,
      requestedAt: NOW - 10,
      purgeAfter: NOW + 100,
    });
    // A closed profile whose sign-in row is gone has no address to send to.
    await db
      .insert(userProfiles)
      .values({ userId: "gone-runner", bannedAt: NOW - 60 });
    const mail = fakeMail();
    for (const userId of [
      open.userId,
      "no-such-runner",
      "gone-runner",
      leaving.userId,
    ]) {
      expect(
        await sendDeletionLink(db, userId, mail, NOW),
        userId,
      ).toStrictEqual({ status: "refused" });
    }
    expect(mail.sent).toStrictEqual([]);
    expect(await linkRows()).toStrictEqual([]);
  });

  it("withdraws the link when the send fails, so the next press sends a fresh one", async () => {
    const { userId } = await closedRunner();
    const mail = fakeMail();
    mail.failing(true);
    await expect(sendDeletionLink(db, userId, mail, NOW)).rejects.toThrow(
      "send failed",
    );
    expect(await linkRows()).toStrictEqual([]);
    mail.failing(false);
    expect(await sendDeletionLink(db, userId, mail, NOW)).toMatchObject({
      status: "sent",
    });
  });
});

describe("readDeletionLanding (opening the link spends nothing)", () => {
  it("asks first, with the handle and the day a deletion would land", async () => {
    const { userId } = await closedRunner({ handle: "runner_1290" });
    const token = await sentToken(userId);
    expect(await readDeletionLanding(db, token, NOW + 60)).toStrictEqual({
      state: "ask",
      handle: "runner_1290",
      day: DAY(NOW + 60 + DELETION_GRACE_S),
    });
    expect(await deletionRows()).toStrictEqual([]);
    expect(await usedAtOfLink()).toBeUndefined();
  });

  it("says its day on the runner's home zone (owner, 2026-11-27)", async () => {
    const { userId } = await closedRunner({ timeZone: "Pacific/Honolulu" });
    const token = await sentToken(userId);
    // 08:00 UTC on a Friday is still Thursday in Honolulu.
    const at = Date.UTC(2027, 0, 8, 8) / 1000 - DELETION_GRACE_S;
    expect(await readDeletionLanding(db, token, at)).toMatchObject({
      day: "Thu, Jan 7",
    });
  });

  it("asks a runner with no handle with none", async () => {
    const { userId } = await closedRunner();
    const token = await sentToken(userId);
    expect(await readDeletionLanding(db, token, NOW)).toMatchObject({
      state: "ask",
      handle: undefined,
    });
  });

  it("says the link doesn't work: run out, replaced, malformed, another purpose's, or reopened", async () => {
    const { userId, email } = await closedRunner();
    const token = await sentToken(userId);
    expect(
      await readDeletionLanding(db, token, NOW + DELETION_LINK_TTL_S),
    ).toStrictEqual({ state: "expired" });
    expect(
      await readDeletionLanding(db, token, NOW + DELETION_LINK_TTL_S - 1),
    ).toMatchObject({ state: "ask" });
    const confirm = await issueEmailLink(db, {
      userId,
      purpose: "verify",
      email,
    });
    for (const bad of [`${token}x`, "", 42, confirm]) {
      expect(
        await readDeletionLanding(db, bad, NOW),
        String(bad),
      ).toStrictEqual({ state: "expired" });
    }
    await db
      .update(userProfiles)
      .set({ bannedAt: sql`NULL` })
      .where(eq(userProfiles.userId, userId));
    expect(await readDeletionLanding(db, token, NOW)).toStrictEqual({
      state: "expired",
    });
  });

  it("says a used link with no deletion pending doesn't work", async () => {
    const { userId } = await closedRunner();
    const token = await sentToken(userId);
    await db
      .update(emailVerifications)
      .set({ usedAt: NOW })
      .where(eq(emailVerifications.userId, userId));
    expect(await readDeletionLanding(db, token, NOW + 10)).toStrictEqual({
      state: "expired",
    });
  });
});

describe("confirmDeletionLink (round 64 #374.3–374.4)", () => {
  it("schedules the purge a week on, owes the closed delete-scheduled email, and disconnects Strava", async () => {
    const { userId, email } = await closedRunner({ handle: "runner_1290" });
    const token = await sentToken(userId);
    const mail = fakeMail();
    const { effects, settled, disconnectStrava } = effectsFor(mail);
    const at = NOW + 3600;
    const purgeAfter = at + DELETION_GRACE_S;

    expect(await confirmDeletionLink(db, token, effects, at)).toStrictEqual({
      state: "done",
      day: DAY(purgeAfter),
    });
    expect(await deletionRows()).toStrictEqual([
      {
        userId,
        requestedAt: at,
        purgeAfter,
        cause: "asked",
        closedUnder18At: undefined,
      },
    ]);
    expect(await usedAtOfLink()).toBe(at);
    // Owed in the deletion's batch, then sent after the answer, under the
    // key a runner's own request owes it by.
    expect(
      await db
        .select({ kind: outbox.kind, key: outbox.dedupeKey })
        .from(outbox),
    ).toStrictEqual([
      {
        kind: "email",
        key: `deletion_scheduled:${userId}:${String(purgeAfter)}`,
      },
    ]);
    await settled();
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]?.to).toBe(email);
    expect(mail.sent[0]?.text).toContain(
      `If this wasn't you, reply to this email before ${DAY(purgeAfter)}.`,
    );
    expect(mail.sent[0]?.text).not.toContain("Keep my account");
    expect(disconnectStrava).toHaveBeenCalledWith(userId);
  });

  it("then says the link was used, with the day the account goes", async () => {
    const { userId } = await closedRunner();
    const token = await sentToken(userId);
    const { effects } = effectsFor(fakeMail());
    await confirmDeletionLink(db, token, effects, NOW + 10);
    const used = {
      state: "used",
      day: DAY(NOW + 10 + DELETION_GRACE_S),
    } as const;
    expect(await readDeletionLanding(db, token, NOW + 20)).toStrictEqual(used);
    expect(
      await confirmDeletionLink(db, token, effects, NOW + 20),
    ).toStrictEqual(used);
    expect(await deletionRows()).toHaveLength(1);
  });

  it("schedules once when two presses race: the other reads used", async () => {
    const { userId } = await closedRunner();
    const token = await sentToken(userId);
    const { effects } = effectsFor(fakeMail());
    const answers = await Promise.all([
      confirmDeletionLink(db, token, effects, NOW + 10),
      confirmDeletionLink(db, token, effects, NOW + 10),
    ]);
    expect(
      answers
        .map((answer) => answer.state)
        .toSorted((a, b) => a.localeCompare(b)),
    ).toStrictEqual(["done", "used"]);
    expect(await deletionRows()).toHaveLength(1);
    expect(await db.select().from(outbox)).toHaveLength(1);
  });

  it("schedules nothing for a link that doesn't work", async () => {
    const { userId } = await closedRunner();
    const token = await sentToken(userId);
    const { effects, disconnectStrava } = effectsFor(fakeMail());
    expect(
      await confirmDeletionLink(db, token, effects, NOW + DELETION_LINK_TTL_S),
    ).toStrictEqual({ state: "expired" });
    expect(await deletionRows()).toStrictEqual([]);
    expect(disconnectStrava).not.toHaveBeenCalled();
  });

  it("schedules nothing for an account reopened after the link was read", async () => {
    const { userId } = await closedRunner();
    const token = await sentToken(userId);
    const { effects } = effectsFor(fakeMail());
    // The read sees it closed; the batch, after the reopen, does not.
    const batch = db.batch.bind(db);
    const spy = vi.spyOn(db, "batch").mockImplementationOnce(async (items) => {
      await db
        .update(userProfiles)
        .set({ bannedAt: sql`NULL` })
        .where(eq(userProfiles.userId, userId));
      return batch(items);
    });
    try {
      expect(await confirmDeletionLink(db, token, effects, NOW)).toStrictEqual({
        state: "expired",
      });
    } finally {
      spy.mockRestore();
    }
    expect(await deletionRows()).toStrictEqual([]);
    expect(await db.select().from(outbox)).toStrictEqual([]);
  });

  it("hands the link back when the deletion does not land", async () => {
    const { userId } = await closedRunner();
    const token = await sentToken(userId);
    const { effects } = effectsFor(fakeMail());
    const spy = vi
      .spyOn(db, "batch")
      .mockRejectedValueOnce(new Error("D1 is down"));
    try {
      await expect(
        confirmDeletionLink(db, token, effects, NOW),
      ).rejects.toThrow("D1 is down");
    } finally {
      spy.mockRestore();
    }
    expect(await usedAtOfLink()).toBeUndefined();
    expect(
      await confirmDeletionLink(db, token, effects, NOW + 1),
    ).toMatchObject({ state: "done" });
  });

  it("still schedules when Strava fails to disconnect, and reports it", async () => {
    const { userId } = await closedRunner();
    const token = await sentToken(userId);
    const { effects, disconnectStrava, report } = effectsFor(fakeMail());
    const failure = new Error("strava down");
    disconnectStrava.mockRejectedValueOnce(failure);
    expect(await confirmDeletionLink(db, token, effects, NOW)).toMatchObject({
      state: "done",
    });
    expect(report).toHaveBeenCalledWith(failure, {
      surface: "deletion-link-strava",
      userId,
    });
  });
});

describe("ageClosure (round 64 #373, #374.2)", () => {
  it("schedules the deletion a week on in the closure's batch, and owes the age email", async () => {
    const { userId } = await closedRunner({ handle: "runner_1290" });
    const closure = await ageClosure(db, userId, true, NOW);
    expect(closure.email).toStrictEqual({
      kind: "email",
      payload: {
        email: {
          to: { userId },
          template: {
            kind: "account_closed_age",
            day: DAY(NOW + DELETION_GRACE_S),
            handle: "runner_1290",
          },
        },
        dedupeKey: `account_closed:${userId}`,
      },
    });
    const writes = closure.writes(db);
    expect(writes).toHaveLength(1);
    await run(writes);
    expect(await deletionRows()).toStrictEqual([
      {
        userId,
        requestedAt: NOW,
        purgeAfter: NOW + DELETION_GRACE_S,
        cause: "under_18",
        closedUnder18At: NOW,
      },
    ]);
  });

  it("names no handle for a runner who has none", async () => {
    const { userId } = await closedRunner();
    const closure = await ageClosure(db, userId, true, NOW);
    expect(closure.email?.payload.email.template).toStrictEqual({
      kind: "account_closed_age",
      day: DAY(NOW + DELETION_GRACE_S),
    });
  });

  it("keeps a runner's own earlier request, its date and its cause, and marks it as closed for age", async () => {
    const { userId } = await closedRunner();
    const own = { userId, requestedAt: NOW - 100, purgeAfter: NOW + 500 };
    await db.insert(accountDeletions).values(own);
    const closure = await ageClosure(db, userId, true, NOW);
    expect(closure.email?.payload.email.template).toMatchObject({
      day: DAY(NOW + 500),
    });
    await run(closure.writes(db));
    expect(await deletionRows()).toStrictEqual([
      { ...own, cause: "asked", closedUnder18At: NOW },
    ]);
  });

  it("schedules and owes nothing for any other closure", async () => {
    const { userId } = await closedRunner();
    const closure = await ageClosure(db, userId, false, NOW);
    expect(closure.email).toBeUndefined();
    expect(closure.writes(db)).toStrictEqual([]);
  });
});

/**
The lift's own condition, as safety's `unbanUser` writes it.
*/
function stillBanned(userId: string) {
  return {
    table: userProfiles,
    where: sql`${userProfiles.userId} = ${userId} AND ${userProfiles.bannedAt} IS NOT NULL AND NOT ${reopenHeldBy(userId)}`,
  };
}

async function isReopenable(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ held: sql<number>`${reopenHeldBy(userId)}` })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId));
  return row?.held === 0;
}

async function ageClosed(userId: string): Promise<void> {
  const closure = await ageClosure(db, userId, true, NOW);
  await run(closure.writes(db));
}

describe("Reopen (round 64 #372–373; owner, 2026-11-27)", () => {
  it("cancels an age closure's deletion and withdraws a link", async () => {
    const { userId, email } = await closedRunner();
    await issueEmailLink(db, { userId, purpose: "delete", email });
    await ageClosed(userId);
    expect(await isReopenable(userId)).toBe(true);
    await run(reopenDeletionWrites(db, userId, stillBanned(userId)));
    expect(await deletionRows()).toStrictEqual([]);
    expect(await linkRows()).toStrictEqual([]);
  });

  it("is held by a deletion the runner chose, and undoes nothing then", async () => {
    const { userId } = await closedRunner();
    const token = await sentToken(userId);
    await confirmDeletionLink(db, token, effectsFor(fakeMail()).effects, NOW);
    expect(await isReopenable(userId)).toBe(false);
    await run(reopenDeletionWrites(db, userId, stillBanned(userId)));
    expect(await deletionRows()).toHaveLength(1);
    expect(await linkRows()).toHaveLength(1);
  });

  it("is held once an age closure's purge has started", async () => {
    const { userId } = await closedRunner();
    await db.insert(accountDeletions).values({
      userId,
      requestedAt: NOW,
      purgeAfter: NOW,
      purgeStartedAt: NOW + 1,
      cause: "under_18",
    });
    expect(await isReopenable(userId)).toBe(false);
  });

  it("leaves every other runner's deletion and link alone", async () => {
    const one = await closedRunner();
    const other = await closedRunner();
    await issueEmailLink(db, {
      userId: other.userId,
      purpose: "delete",
      email: other.email,
    });
    await ageClosed(other.userId);
    await run(reopenDeletionWrites(db, one.userId, stillBanned(one.userId)));
    expect(await deletionRows()).toHaveLength(1);
    expect(await linkRows()).toHaveLength(1);
  });
});

describe("deletionLinksOf", () => {
  it("reads each listed account's deletion link, and no other purpose's", async () => {
    const sent = await closedRunner();
    const used = await closedRunner();
    const none = await closedRunner();
    await issueEmailLink(db, { ...sent, purpose: "delete" }, NOW);
    await issueEmailLink(db, { ...none, purpose: "verify" }, NOW);
    const token = await issueEmailLink(db, { ...used, purpose: "delete" }, NOW);
    await confirmDeletionLink(db, token, effectsFor(fakeMail()).effects, NOW);
    const links = new Map(
      await deletionLinksOf(db, [sent.userId, used.userId, none.userId]),
    );
    expect(Object.fromEntries(links)).toStrictEqual({
      [sent.userId]: { expiresAt: NOW + DELETION_LINK_TTL_S, isUsed: false },
      [used.userId]: { expiresAt: NOW + DELETION_LINK_TTL_S, isUsed: true },
    });
  });
});
