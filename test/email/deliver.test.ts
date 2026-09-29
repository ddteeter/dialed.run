import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { user } from "../../src/db/schema-auth";
import {
  emailSendLimits,
  notificationPreferences,
  outbox,
} from "../../src/db/schema-core";
import {
  emailPayloadSchema,
  preferenceFor,
  type EmailKind,
} from "../../src/lib/email";
import { nowSeconds } from "../../src/lib/now";
import { dedupeKeyFor } from "../../src/lib/outbox";
import {
  claimEmailSend,
  deliverEmail,
  emailDebt,
  emailDepsFromEnv,
  emailPreferencesOf,
  forgetSendLimits,
  setEmailPreference,
  isEmailWanted,
} from "../../src/modules/email";
import { deliverOwedEmail, EMAIL_FROM } from "../../src/modules/email/deliver";
import {
  SEND_WINDOW_S,
  SENDS_PER_WINDOW,
} from "../../src/modules/email/send-limit";
import {
  unsubscribeSignature,
  unsubscribeUrl,
  verifiedUnsubscribe,
} from "../../src/modules/email/unsubscribe";
import {
  drainOutbox,
  outboxInsert,
  oweOutbox,
  OUTBOX_FAST_PATH_GRACE_S,
  settleOutbox,
} from "../../src/modules/ops/outbox";
import {
  emailHandler,
  outboxHandlers,
  type OutboxHandlers,
} from "../../src/modules/ops/outbox-handlers";
import { handleScheduled } from "../../src/modules/ops";
import {
  CLOUDFLARE_DISALLOWED_HEADERS,
  core,
  fakeMail,
  ORIGIN,
  refusedHeaders,
  SECRET,
  seedUser,
} from "./helpers";

/**
 * The one sender (ACC-2), on real D1: who it writes to, what it will not
 * send, the headers an optional email carries, and the outbox that owes it.
 */

const db = core();
const NOW = 1_800_000_000;

beforeEach(async () => {
  await db.batch([
    db.delete(notificationPreferences),
    db.delete(emailSendLimits),
    db.delete(outbox),
  ]);
});

const REMINDER = {
  kind: "run_reminder",
  landedAt: "6:58 AM",
  runs: 1,
} as const;

describe("deliverEmail", () => {
  it("hands the binding the runner's current address, from us, with both bodies", async () => {
    const mail = fakeMail();
    const { userId, email } = await seedUser();

    const outcome = await deliverEmail(
      db,
      { to: { userId }, template: { kind: "existing_account" } },
      mail,
    );

    expect(outcome).toBe("sent");
    expect(mail.sent).toHaveLength(1);
    const [message] = mail.sent;
    expect(message).toMatchObject({
      from: { name: "dialed.run", email: "hello@dialed.run" },
      to: email,
      subject: "You already have a dialed.run account",
    });
    expect(message?.html).toContain("It already has one.");
    expect(message?.text).toContain("Log in [https://dialed.test/auth/login]");
    // A transactional email carries no unsubscribe header.
    expect(message).not.toHaveProperty("headers");
    expect(EMAIL_FROM).toStrictEqual({
      name: "dialed.run",
      email: "hello@dialed.run",
    });
  });

  it("writes to an address as given, account or not", async () => {
    const mail = fakeMail();
    await deliverEmail(
      db,
      {
        to: { address: "someone@example.com" },
        template: { kind: "email_changed", newEmail: "new@example.com" },
      },
      mail,
    );
    expect(mail.sent.map((message) => message.to)).toStrictEqual([
      "someone@example.com",
    ]);
  });

  it("reads the address when it sends, so a changed one is the one written to", async () => {
    const mail = fakeMail();
    const { userId } = await seedUser({ email: "old@example.com" });
    await db
      .update(user)
      .set({ email: "new@example.com" })
      .where(eq(user.id, userId));
    await deliverEmail(
      db,
      { to: { userId }, template: { kind: "existing_account" } },
      mail,
    );
    expect(mail.sent[0]?.to).toBe("new@example.com");
  });

  it("skips a runner who is gone", async () => {
    const mail = fakeMail();
    expect(
      await deliverEmail(
        db,
        { to: { userId: "gone" }, template: { kind: "existing_account" } },
        mail,
      ),
    ).toBe("skipped");
    expect(mail.sent).toHaveLength(0);
  });

  it("sends transactional mail to an unconfirmed address — it is how the address gets confirmed", async () => {
    const mail = fakeMail();
    const { userId } = await seedUser({ isVerified: false });
    expect(
      await deliverEmail(
        db,
        {
          to: { userId },
          template: { kind: "verify_email", url: `${ORIGIN}/v` },
        },
        mail,
      ),
    ).toBe("sent");
  });

  it("sends the optional reminder with a one-click unsubscribe that is this runner's", async () => {
    const mail = fakeMail();
    const { userId } = await seedUser();

    expect(
      await deliverEmail(db, { to: { userId }, template: REMINDER }, mail),
    ).toBe("sent");

    const url = await unsubscribeUrl(ORIGIN, SECRET, userId, "run_reminder");
    expect(mail.sent[0]?.headers).toStrictEqual({
      "List-Unsubscribe": `<${url}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    // …and the footer's "Stop run reminder emails" is the same link.
    expect(mail.sent[0]?.html).toContain(url.replaceAll("&", "&amp;"));
  });

  it("does not send optional mail to an unconfirmed address, an address alone, or a runner who said no", async () => {
    const mail = fakeMail();
    const unconfirmed = await seedUser({ isVerified: false });
    const declined = await seedUser();
    await setEmailPreference(db, declined.userId, "run_reminder", false);

    for (const to of [
      { userId: unconfirmed.userId },
      { address: "someone@example.com" },
      { userId: declined.userId },
    ]) {
      expect(await deliverEmail(db, { to, template: REMINDER }, mail)).toBe(
        "skipped",
      );
    }
    expect(mail.sent).toHaveLength(0);
  });

  it("sends no optional mail without the unsubscribe secret, and transactional mail still goes", async () => {
    const mail = fakeMail();
    const { userId } = await seedUser();
    for (const secret of [undefined, ""]) {
      const unkeyed = { ...mail, secret };
      expect(
        await deliverEmail(db, { to: { userId }, template: REMINDER }, unkeyed),
      ).toBe("skipped");
      expect(
        await deliverEmail(
          db,
          { to: { userId }, template: { kind: "existing_account" } },
          unkeyed,
        ),
      ).toBe("sent");
    }
    expect(mail.sent.map((message) => message.subject)).toHaveLength(2);
  });

  it("throws when the binding does, so the outbox keeps the debt", async () => {
    const mail = fakeMail();
    mail.failing(true);
    const { userId } = await seedUser();
    await expect(
      deliverEmail(
        db,
        { to: { userId }, template: { kind: "existing_account" } },
        mail,
      ),
    ).rejects.toThrow("send failed");
  });
});

describe("emailDepsFromEnv", () => {
  it("sends through the binding, from the deployment's origin", async () => {
    const sent: unknown[] = [];
    const deps = emailDepsFromEnv({
      EMAIL: {
        send: (message: unknown) => {
          sent.push(message);
          return Promise.resolve({ messageId: "m" });
        },
      },
      BETTER_AUTH_URL: ORIGIN,
      UNSUBSCRIBE_SECRET: SECRET,
    });
    expect([deps.origin, deps.secret]).toStrictEqual([ORIGIN, SECRET]);
    await deps.send({ from: "a@b.c", to: "d@e.f", subject: "s", text: "t" });
    expect(sent).toStrictEqual([
      { from: "a@b.c", to: "d@e.f", subject: "s", text: "t" },
    ]);
  });

  it("refuses to send without an origin, rather than mail a relative link", () => {
    expect(() =>
      emailDepsFromEnv({
        EMAIL: { send: () => Promise.resolve({ messageId: "m" }) },
        BETTER_AUTH_URL: undefined,
        UNSUBSCRIBE_SECRET: SECRET,
      }),
    ).toThrow("BETTER_AUTH_URL is not set");
  });
});

describe("preferences", () => {
  it("has the reminder on until the runner turns it off, and back on", async () => {
    const { userId } = await seedUser();
    expect(await isEmailWanted(db, userId, "run_reminder")).toBe(true);
    expect(await emailPreferencesOf(db, userId)).toStrictEqual({
      run_reminder: true,
    });

    await setEmailPreference(db, userId, "run_reminder", false);
    // Twice, as a link opened twice does: still one row, still off.
    await setEmailPreference(db, userId, "run_reminder", false);
    expect(await isEmailWanted(db, userId, "run_reminder")).toBe(false);
    expect(await emailPreferencesOf(db, userId)).toStrictEqual({
      run_reminder: false,
    });
    expect(
      await db
        .select()
        .from(notificationPreferences)
        .where(eq(notificationPreferences.userId, userId)),
    ).toHaveLength(1);

    await setEmailPreference(db, userId, "run_reminder", true);
    expect(await isEmailWanted(db, userId, "run_reminder")).toBe(true);
  });

  it("is one runner's alone", async () => {
    const one = await seedUser();
    const other = await seedUser();
    await setEmailPreference(db, one.userId, "run_reminder", false);
    expect(await isEmailWanted(db, other.userId, "run_reminder")).toBe(true);
    expect(await emailPreferencesOf(db, other.userId)).toStrictEqual({
      run_reminder: true,
    });
  });

  it("governs the reminder only: every other email is transactional", () => {
    const kinds: EmailKind[] = [
      "verify_email",
      "existing_account",
      "reset_password",
      "email_change",
      "email_changed",
      "content_removed",
      "account_closed",
    ];
    for (const kind of kinds) expect(preferenceFor(kind), kind).toBeUndefined();
    expect(preferenceFor("run_reminder")).toBe("run_reminder");
  });
});

describe("the unsubscribe link", () => {
  it("names the runner and kind it was signed for, and nothing it was not", async () => {
    const url = new URL(
      await unsubscribeUrl(ORIGIN, SECRET, "u1", "run_reminder"),
    );
    expect(`${url.origin}${url.pathname}`).toBe(
      `${ORIGIN}/account/unsubscribe`,
    );
    const search = Object.fromEntries(url.searchParams);
    expect(search).toStrictEqual({
      u: "u1",
      k: "run_reminder",
      s: await unsubscribeSignature(SECRET, "u1", "run_reminder"),
    });
    expect(await verifiedUnsubscribe(SECRET, search)).toStrictEqual({
      userId: "u1",
      kind: "run_reminder",
    });

    // Someone else's id under this signature, another key, a mangled or
    // missing signature, a kind that is not one: all refused.
    expect(
      await verifiedUnsubscribe(SECRET, { ...search, u: "u2" }),
    ).toBeUndefined();
    expect(await verifiedUnsubscribe("another-secret", search)).toBeUndefined();
    expect(
      await verifiedUnsubscribe(SECRET, { ...search, s: `${search.s ?? ""}A` }),
    ).toBeUndefined();
    expect(
      await verifiedUnsubscribe(SECRET, { ...search, s: "not base64url!" }),
    ).toBeUndefined();
    expect(
      await verifiedUnsubscribe(SECRET, { ...search, k: "useful" }),
    ).toBeUndefined();
    expect(await verifiedUnsubscribe(SECRET, { u: "u1" })).toBeUndefined();
  });

  it("is a URL-safe signature with no padding, stable for one runner and kind", async () => {
    const signature = await unsubscribeSignature(SECRET, "u1", "run_reminder");
    expect(signature).toMatch(/^[\w-]{43}$/u);
    expect(await unsubscribeSignature(SECRET, "u1", "run_reminder")).toBe(
      signature,
    );
    expect(await unsubscribeSignature(SECRET, "u2", "run_reminder")).not.toBe(
      signature,
    );
  });
});

describe("claimEmailSend", () => {
  it("lets five go in an hour, refuses the sixth until the hour is up, then starts over", async () => {
    for (let n = 0; n < SENDS_PER_WINDOW; n += 1) {
      expect(
        await claimEmailSend(db, "verify", "a@example.com", NOW + n),
      ).toStrictEqual({ isAllowed: true });
    }
    expect(
      await claimEmailSend(db, "verify", "A@example.com", NOW + 60),
    ).toStrictEqual({ isAllowed: false, until: NOW + SEND_WINDOW_S });
    // A second before the hour: still the same window.
    expect(
      await claimEmailSend(
        db,
        "verify",
        "a@example.com",
        NOW + SEND_WINDOW_S - 1,
      ),
    ).toStrictEqual({ isAllowed: false, until: NOW + SEND_WINDOW_S });
    expect(
      await claimEmailSend(db, "verify", "a@example.com", NOW + SEND_WINDOW_S),
    ).toStrictEqual({ isAllowed: true });
    const [row] = await db.select().from(emailSendLimits);
    expect(row).toStrictEqual({
      key: "verify:a@example.com",
      windowStartedAt: NOW + SEND_WINDOW_S,
      sends: 1,
    });
    expect([SENDS_PER_WINDOW, SEND_WINDOW_S]).toStrictEqual([5, 3600]);
  });

  it("counts each kind and address on its own", async () => {
    for (let n = 0; n < SENDS_PER_WINDOW + 1; n += 1) {
      await claimEmailSend(db, "verify", "a@example.com", NOW);
    }
    expect(
      await claimEmailSend(db, "reset", "a@example.com", NOW),
    ).toStrictEqual({ isAllowed: true });
    expect(
      await claimEmailSend(db, "verify", "b@example.com", NOW),
    ).toStrictEqual({ isAllowed: true });
  });
});

describe("the email outbox kind", () => {
  it("is keyed by its writer and held back until its notBefore", async () => {
    const payload = { to: { userId: "u1" }, template: REMINDER } as const;
    const held = emailDebt(payload, { dedupeKey: "reminder:u1:2026-09-27" });
    expect(held).toStrictEqual({
      kind: "email",
      payload: { dedupeKey: "reminder:u1:2026-09-27", email: payload },
    });
    expect(dedupeKeyFor(held)).toBe("reminder:u1:2026-09-27");
    const now = emailDebt(payload, { dedupeKey: "k" });

    const heldDebt = oweOutbox(held, NOW + 20 * 60 + 1);
    expect(heldDebt.notBefore).toBe(NOW + 20 * 60 + 1);
    const nowDebt = oweOutbox(now);
    await db.batch([
      outboxInsert(db, heldDebt, NOW),
      outboxInsert(db, nowDebt, NOW),
    ]);
    const rows = await db.select().from(outbox);
    const due = new Map(rows.map((row) => [row.id, row.nextAttemptAt]));
    // Held back past the fast path's grace; an immediate one gets the grace.
    expect(due.get(heldDebt.id)).toBe(NOW + 20 * 60 + 1);
    expect(due.get(nowDebt.id)).toBe(NOW + OUTBOX_FAST_PATH_GRACE_S);
  });

  it("is sent by the fast path, which then forgets it", async () => {
    const { userId } = await seedUser();
    const mail = fakeMail();
    const debt = oweOutbox(
      emailDebt(
        { to: { userId }, template: { kind: "existing_account" } },
        { dedupeKey: "k1" },
      ),
    );
    await outboxInsert(db, debt, NOW);
    await settleOutbox(db, debt, quiet, handlersSendingTo(mail));
    expect(mail.sent).toHaveLength(1);
    expect(await db.select().from(outbox)).toHaveLength(0);
  });

  it("marks the row sent with the sender's id, and the drain deletes a sent row rather than sending it again", async () => {
    const { userId } = await seedUser();
    const mail = fakeMail();
    const debt = oweOutbox(
      emailDebt(
        { to: { userId }, template: { kind: "existing_account" } },
        { dedupeKey: "sent-not-deleted" },
      ),
    );
    await outboxInsert(db, debt, NOW);
    // The Worker dies between the send and the delete: the fast path's
    // delete never lands.
    const remove = vi.spyOn(db, "delete").mockImplementationOnce(() => {
      throw new Error("worker gone");
    });
    await settleOutbox(db, debt, quiet, handlersSendingTo(mail));
    remove.mockRestore();

    expect(mail.sent).toHaveLength(1);
    const [row] = await db.select().from(outbox);
    expect(row?.sentAt).toBeTypeOf("number");
    // Due the moment it was sent, so the drain's index range finds it.
    expect(row?.nextAttemptAt).toBe(row?.sentAt);
    expect(row?.messageId).toBe(mail.ids[0]);

    // The next drain — before the row would even be due — clears it and
    // sends nothing.
    const anomalies: string[] = [];
    await drainOutbox(db, anomalies, {
      handlers: handlersSendingTo(mail),
      now: NOW + 1,
      kinds: ["email"],
    });
    expect(mail.sent).toHaveLength(1);
    expect(await db.select().from(outbox)).toHaveLength(0);
    expect(anomalies).toStrictEqual([
      "1 email outbox row(s) were owed; 1 settled",
    ]);
  });

  it("does not resend a sent row that the drain finds due, either", async () => {
    const { userId } = await seedUser();
    const mail = fakeMail();
    const debt = oweOutbox(
      emailDebt(
        { to: { userId }, template: { kind: "existing_account" } },
        { dedupeKey: "sent-and-due" },
      ),
    );
    await outboxInsert(db, debt, NOW);
    await db
      .update(outbox)
      .set({ sentAt: NOW, messageId: "earlier" })
      .where(eq(outbox.id, debt.id));

    await drainOutbox(db, [], {
      handlers: handlersSendingTo(mail),
      now: NOW + OUTBOX_FAST_PATH_GRACE_S,
      kinds: ["email"],
    });

    expect(mail.sent).toHaveLength(0);
    expect(await db.select().from(outbox)).toHaveLength(0);
  });

  it("leaves an unsent row that is not yet due to its fast path", async () => {
    const debt = oweOutbox(
      emailDebt(
        {
          to: { address: "a@example.com" },
          template: { kind: "existing_account" },
        },
        { dedupeKey: "not-yet" },
      ),
    );
    await outboxInsert(db, debt, NOW);
    const mail = fakeMail();
    await drainOutbox(db, [], {
      handlers: handlersSendingTo(mail),
      now: NOW + 1,
      kinds: ["email"],
    });
    expect(mail.sent).toHaveLength(0);
    expect(await db.select().from(outbox)).toHaveLength(1);
  });

  it("marks nothing for an email it skipped", async () => {
    const debt = oweOutbox(
      emailDebt(
        { to: { userId: "gone" }, template: { kind: "existing_account" } },
        { dedupeKey: "skipped" },
      ),
    );
    await outboxInsert(db, debt, NOW);
    const update = vi.spyOn(db, "update");
    await settleOutbox(db, debt, quiet, handlersSendingTo(fakeMail()));
    expect(update).not.toHaveBeenCalled();
    update.mockRestore();
    expect(await db.select().from(outbox)).toHaveLength(0);
  });

  it("stays owed when the send fails, reported with no address in it", async () => {
    const { userId } = await seedUser();
    const mail = fakeMail();
    mail.failing(true);
    const reports: Record<string, string>[] = [];
    const debt = oweOutbox(
      emailDebt(
        { to: { userId }, template: { kind: "existing_account" } },
        { dedupeKey: "k2" },
      ),
    );
    await outboxInsert(db, debt, NOW);
    await settleOutbox(
      db,
      debt,
      (_error, context) => {
        reports.push(context);
      },
      handlersSendingTo(mail),
    );
    expect(await db.select().from(outbox)).toHaveLength(1);
    expect(reports).toStrictEqual([
      {
        surface: "outbox-fast-path",
        kind: "email",
        outboxId: debt.id,
        dedupeKey: "k2",
        template: "existing_account",
      },
    ]);

    // The drain, email only, sends it once it is due.
    mail.failing(false);
    const anomalies: string[] = [];
    await drainOutbox(db, anomalies, {
      handlers: handlersSendingTo(mail),
      now: NOW + OUTBOX_FAST_PATH_GRACE_S,
      kinds: ["email"],
    });
    expect(mail.sent).toHaveLength(1);
    expect(anomalies).toStrictEqual([
      "1 email outbox row(s) were owed; 1 settled",
    ]);
    expect(await db.select().from(outbox)).toHaveLength(0);
  });

  it.each([
    ["0 * * * *", "weather-retry"],
    ["30 * * * *", "enrichment-retry"],
    ["15 * * * *", "screening-retry"],
  ])(
    "is sent through the real binding by the hourly firing at %s (%s)",
    async (cron, cronName) => {
      const { userId } = await seedUser();
      const debt = oweOutbox(
        emailDebt(
          { to: { userId }, template: { kind: "existing_account" } },
          { dedupeKey: `hourly:${cron}` },
        ),
      );
      // Due already: written before the grace the fast path had.
      await outboxInsert(db, debt, nowSeconds() - 3600);

      const outcome = await handleScheduled({
        cron,
      } as ScheduledController);

      expect(outcome.cronName).toBe(cronName);
      expect(outcome.anomalies).toContain(
        "1 email outbox row(s) were owed; 1 settled",
      );
      expect(await db.select().from(outbox)).toHaveLength(0);
    },
  );

  it("drains only the kinds it is asked to", async () => {
    const debt = oweOutbox({
      kind: "photo_delete",
      payload: { userId: "u", itemId: "i" },
    });
    await outboxInsert(db, debt, NOW);
    const anomalies: string[] = [];
    await drainOutbox(db, anomalies, {
      now: NOW + OUTBOX_FAST_PATH_GRACE_S,
      kinds: ["email"],
    });
    expect(anomalies).toStrictEqual([]);
    expect(await db.select().from(outbox)).toHaveLength(1);
  });

  it("parses what it wrote back: the payload is the wire format", () => {
    expect(
      emailPayloadSchema.safeParse({
        to: { userId: "u1", address: "a@example.com" },
        template: { kind: "existing_account" },
      }).success,
    ).toBe(false);
    expect(
      emailPayloadSchema.safeParse({
        to: { address: "a@example.com" },
        template: { kind: "verify_email", url: "javascript:alert(1)" },
      }).success,
    ).toBe(false);
  });
});

function quiet(): void {
  // the fast path succeeds here, so there is nothing to report
}

/**
The real handlers, with the email one sending through `mail`.
*/
function handlersSendingTo(mail: ReturnType<typeof fakeMail>): OutboxHandlers {
  return { ...outboxHandlers, email: emailHandler(() => mail) };
}

describe("an owed email", () => {
  it("carries no header Cloudflare refuses, Message-ID included", async () => {
    const mail = fakeMail();
    const { userId } = await seedUser();
    await deliverOwedEmail(
      db,
      {
        to: { address: "a@example.com" },
        template: { kind: "existing_account" },
      },
      mail,
    );
    // An optional email is the one with headers at all.
    await deliverOwedEmail(db, { to: { userId }, template: REMINDER }, mail);

    expect(mail.sent).toHaveLength(2);
    expect(mail.sent[0]?.headers).toBeUndefined();
    expect(Object.keys(mail.sent[1]?.headers ?? {})).toStrictEqual([
      "List-Unsubscribe",
      "List-Unsubscribe-Post",
    ]);
    expect(mail.sent.flatMap((message) => refusedHeaders(message))).toEqual([]);
  });

  it("is refused by the fake as Cloudflare refuses it, so the rule holds in every test", async () => {
    expect(CLOUDFLARE_DISALLOWED_HEADERS).toContain("Message-ID");
    const mail = fakeMail();
    await expect(
      mail.send({
        from: EMAIL_FROM,
        to: "a@example.com",
        subject: "s",
        text: "t",
        headers: { "message-id": "<x@dialed.run>" },
      }),
    ).rejects.toThrow("E_HEADER_NOT_ALLOWED: message-id");
    await expect(
      mail.send({
        from: EMAIL_FROM,
        to: "a@example.com",
        subject: "s",
        text: "t",
        headers: { "ARC-Seal": "x", "X-Dialed": "ok" },
      }),
    ).rejects.toThrow("E_HEADER_NOT_ALLOWED: ARC-Seal");
    expect(mail.sent).toStrictEqual([]);
  });

  it("answers the sender's own id", async () => {
    const mail = fakeMail();
    const sent = await deliverOwedEmail(
      db,
      {
        to: { address: "a@example.com" },
        template: { kind: "existing_account" },
      },
      mail,
    );
    expect(sent).toStrictEqual({ status: "sent", messageId: mail.ids[0] });
  });

  it("answers no id when the sender gives none", async () => {
    const mail = fakeMail();
    const sent = await deliverOwedEmail(
      db,
      {
        to: { address: "a@example.com" },
        template: { kind: "existing_account" },
      },
      { ...mail, send: () => Promise.resolve({}) },
    );
    expect(sent).toStrictEqual({ status: "sent", messageId: undefined });
  });

  it("sets no headers on a transactional email sent now", async () => {
    const mail = fakeMail();
    await deliverEmail(
      db,
      {
        to: { address: "a@example.com" },
        template: { kind: "existing_account" },
      },
      mail,
    );
    expect(mail.sent[0]?.headers).toBeUndefined();
  });
});

describe("forgetSendLimits (ACC-9)", () => {
  it("forgets an address's counters for every emailed kind, whatever its case, and nothing else", async () => {
    const kept = ["verify:other@example.com", "access:1.2.3.4"];
    await db
      .insert(emailSendLimits)
      .values(
        [
          "verify:gone@example.com",
          "reset:gone@example.com",
          "change:gone@example.com",
          ...kept,
        ].map((key) => ({ key, windowStartedAt: 1, sends: 1 })),
      );
    await forgetSendLimits(db, "Gone@Example.com");
    const left = await db
      .select({ key: emailSendLimits.key })
      .from(emailSendLimits);
    expect(
      left.map((row) => row.key).toSorted((a, b) => a.localeCompare(b)),
    ).toStrictEqual(kept.toSorted((a, b) => a.localeCompare(b)));
  });
});
