import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { outbox } from "../../src/db/schema-core";
import {
  operatorEmailMessage,
  type OutboxMessage,
} from "../../src/lib/sql/outbox";
import { deliverEmail, emailDebt } from "../../src/modules/email";
import { deliverOwedEmail } from "../../src/modules/email/deliver";
import {
  drainOutbox,
  OUTBOX_REFUSED_ATTEMPTS,
  outboxInsert,
  oweOutbox,
  settleOutbox,
} from "../../src/modules/ops/outbox/outbox";
import { outboxHandlers as registryWith } from "../../src/modules/dispatch/outbox-handlers";
import type { OutboxHandlers } from "../../src/modules/ops/outbox/handler";
import { emailHandler } from "../../src/modules/ops/owed-email/owed-email";
import { core, fakeMail, seedUser } from "./helpers";

/**
The drains' registry, as production assembles it (no linker).
*/
const outboxHandlers = registryWith(undefined);

/**
 * An owed email whose address the sender refuses (SA-L22, design 244).
 * Cloudflare's send throws an `Error` with a `code`; two of its codes say
 * this address will not be sent to, and a debt refused that way has an
 * end: it is retried like any failure, then closed and reported once.
 */

const db = core();
const NOW = 1_800_000_000;
const EXISTING = { kind: "existing_account" } as const;

beforeEach(async () => {
  await db.delete(outbox);
});

/**
What the binding throws: an `Error` carrying `code`.
*/
function sendError(code: unknown): Error {
  return Object.assign(new Error("the sender said no"), { code });
}

/**
A sender that answers every send with `error`.
*/
function mailThrowing(error: Error): ReturnType<typeof fakeMail> {
  return { ...fakeMail(), send: () => Promise.reject(error) };
}

function handlersSendingTo(mail: ReturnType<typeof fakeMail>): OutboxHandlers {
  const email = emailHandler(() => mail);
  return { ...outboxHandlers, email, operator_email: email };
}

/**
A debt as a failed fast path left it, due at `NOW` after `attempts` tries.
*/
async function owed(message: OutboxMessage, attempts: number): Promise<string> {
  const debt = oweOutbox(message);
  await outboxInsert(db, debt, NOW);
  await db
    .update(outbox)
    .set({ attempts, nextAttemptAt: NOW })
    .where(eq(outbox.id, debt.id));
  return debt.id;
}

async function rowById(id: string) {
  const [row] = await db.select().from(outbox).where(eq(outbox.id, id));
  return row;
}

describe("deliverOwedEmail, when the sender refuses the address", () => {
  it.each(["E_RECIPIENT_SUPPRESSED", "E_VALIDATION_ERROR"])(
    "answers refused, with the code, for %s",
    async (code) => {
      const { userId } = await seedUser();
      const mail = mailThrowing(sendError(code));
      const answer = await deliverOwedEmail(
        db,
        { to: { userId }, template: EXISTING },
        mail,
      );
      expect(answer).toStrictEqual({ status: "refused", code });
    },
  );

  it.each([
    ["a delivery failure", "E_DELIVERY_FAILED"],
    ["a recipient the binding does not allow", "E_RECIPIENT_NOT_ALLOWED"],
    ["a recipient the plan does not allow", "E_RECIPIENT_PLAN_RESTRICTED"],
    ["the day's limit", "E_DAILY_LIMIT_EXCEEDED"],
    ["no code at all", undefined],
    ["a code that is not a string", 7],
  ])("throws %s on, as the sender threw it", async (_name, code) => {
    const { userId } = await seedUser();
    const error = sendError(code);
    await expect(
      deliverOwedEmail(
        db,
        { to: { userId }, template: EXISTING },
        mailThrowing(error),
      ),
    ).rejects.toBe(error);
  });

  it("leaves an email sent now as it was: the refusal is thrown to its caller", async () => {
    const { userId } = await seedUser();
    const error = sendError("E_RECIPIENT_SUPPRESSED");
    await expect(
      deliverEmail(
        db,
        { to: { userId }, template: EXISTING },
        mailThrowing(error),
      ),
    ).rejects.toBe(error);
  });
});

/**
The real handlers, sending through a sender that refuses the address.
*/
function refusing(): OutboxHandlers {
  return handlersSendingTo(mailThrowing(sendError("E_RECIPIENT_SUPPRESSED")));
}

/**
An email owed to a runner, as an outbox message.
*/
async function runnersDebt(dedupeKey: string): Promise<OutboxMessage> {
  const { userId } = await seedUser();
  return emailDebt({ to: { userId }, template: EXISTING }, { dedupeKey });
}

describe("a refused email in the outbox", () => {
  it("stays owed and unsent below the count, reported with the code", async () => {
    const id = await owed(await runnersDebt("k1"), 0);
    const report = vi.fn();
    const anomalies: string[] = [];

    await drainOutbox(db, anomalies, {
      now: NOW,
      report,
      handlers: refusing(),
      kinds: ["email"],
    });

    const row = await rowById(id);
    expect(row).toMatchObject({ attempts: 1, nextAttemptAt: NOW + 3600 });
    expect(row?.sentAt).toBeNull();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(
      new Error("the sender refused this address: E_RECIPIENT_SUPPRESSED"),
      {
        surface: "outbox-drain",
        kind: "email",
        outboxId: id,
        attempts: "1",
        terminal: "false",
        closed: "false",
        dedupeKey: "k1",
        template: "existing_account",
      },
    );
    expect(anomalies).toStrictEqual([
      "1 email outbox row(s) were owed; 0 settled",
    ]);
  });

  it("is still owed one attempt short of the count", async () => {
    const id = await owed(await runnersDebt("k2"), OUTBOX_REFUSED_ATTEMPTS - 2);
    await drainOutbox(db, [], {
      now: NOW,
      report: vi.fn(),
      handlers: refusing(),
    });
    expect(await rowById(id)).toMatchObject({
      attempts: OUTBOX_REFUSED_ATTEMPTS - 1,
    });
  });

  it("is closed at the count: deleted, reported once as closed with its ids and the code, and counted on a line", async () => {
    const id = await owed(await runnersDebt("k3"), OUTBOX_REFUSED_ATTEMPTS - 1);
    const report = vi.fn();
    const anomalies: string[] = [];

    await drainOutbox(db, anomalies, {
      now: NOW,
      report,
      handlers: refusing(),
      kinds: ["email"],
    });

    expect(await rowById(id)).toBeUndefined();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(
      new Error("the sender refused this address: E_RECIPIENT_SUPPRESSED"),
      {
        surface: "outbox-drain",
        kind: "email",
        outboxId: id,
        attempts: String(OUTBOX_REFUSED_ATTEMPTS),
        terminal: "true",
        closed: "true",
        dedupeKey: "k3",
        template: "existing_account",
      },
    );
    expect(anomalies).toStrictEqual([
      "1 email outbox row(s) were owed; 0 settled",
      `1 email outbox row(s) closed unsent: the sender refused the address ${String(OUTBOX_REFUSED_ATTEMPTS)} times`,
    ]);
  });

  it("is closed past the count too, and an hourly run says so beside what did not settle", async () => {
    const id = await owed(await runnersDebt("k4"), OUTBOX_REFUSED_ATTEMPTS + 3);
    const anomalies: string[] = [];

    await drainOutbox(db, anomalies, {
      now: NOW,
      report: vi.fn(),
      handlers: refusing(),
      kinds: ["email"],
      lines: "unsettled",
    });

    expect(await rowById(id)).toBeUndefined();
    expect(anomalies).toStrictEqual([
      "1 of 1 email outbox row(s) did not settle",
      `1 email outbox row(s) closed unsent: the sender refused the address ${String(OUTBOX_REFUSED_ATTEMPTS)} times`,
    ]);
  });

  it("says nothing of closing when a run closed none", async () => {
    await owed(await runnersDebt("k5"), 0);
    const anomalies: string[] = [];
    await drainOutbox(db, anomalies, {
      now: NOW,
      report: vi.fn(),
      handlers: refusing(),
      kinds: ["email"],
      lines: "unsettled",
    });
    expect(anomalies).toStrictEqual([
      "1 of 1 email outbox row(s) did not settle",
    ]);
  });

  it("never closes an operator's email: it retries for as long as it is refused", async () => {
    const id = await owed(
      operatorEmailMessage(
        { to: { address: "operator@example.com" }, template: EXISTING },
        "op1",
      ),
      OUTBOX_REFUSED_ATTEMPTS + 3,
    );
    const report = vi.fn();
    const anomalies: string[] = [];

    await drainOutbox(db, anomalies, {
      now: NOW,
      report,
      handlers: refusing(),
      kinds: ["operator_email"],
    });

    const row = await rowById(id);
    expect(row?.attempts).toBe(OUTBOX_REFUSED_ATTEMPTS + 4);
    expect(row?.sentAt).toBeNull();
    expect(report).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ kind: "operator_email", closed: "false" }),
    );
    expect(anomalies).toStrictEqual([
      "1 operator_email outbox row(s) were owed; 0 settled",
    ]);
  });

  it("is left for the drain by the fast path, which reports it and closes nothing", async () => {
    const debt = oweOutbox(await runnersDebt("k6"));
    await outboxInsert(db, debt, NOW);
    await db
      .update(outbox)
      .set({ attempts: OUTBOX_REFUSED_ATTEMPTS + 3 })
      .where(eq(outbox.id, debt.id));
    const report = vi.fn();

    await settleOutbox(db, debt, refusing(), report);

    const row = await rowById(debt.id);
    expect(row?.attempts).toBe(OUTBOX_REFUSED_ATTEMPTS + 3);
    expect(row?.sentAt).toBeNull();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(
      new Error("the sender refused this address: E_RECIPIENT_SUPPRESSED"),
      {
        surface: "outbox-fast-path",
        kind: "email",
        outboxId: debt.id,
        dedupeKey: "k6",
        template: "existing_account",
      },
    );
  });

  it("keeps retrying any other failure past the count, as before", async () => {
    const id = await owed(await runnersDebt("k7"), OUTBOX_REFUSED_ATTEMPTS + 3);
    const failure = sendError("E_DELIVERY_FAILED");
    const report = vi.fn();

    await drainOutbox(db, [], {
      now: NOW,
      report,
      handlers: handlersSendingTo(mailThrowing(failure)),
      kinds: ["email"],
    });

    expect(await rowById(id)).toMatchObject({
      attempts: OUTBOX_REFUSED_ATTEMPTS + 4,
    });
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(failure, {
      surface: "outbox-drain",
      kind: "email",
      outboxId: id,
      attempts: String(OUTBOX_REFUSED_ATTEMPTS + 4),
      terminal: "true",
      dedupeKey: "k7",
      template: "existing_account",
    });
  });
});
