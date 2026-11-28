/**
 * Deleting a closed account (design 289; round 64 #372–374). A closed
 * account can't sign in, so the Desk offers it a link instead: emailed to
 * the account's own address, single use, for 7 days, and spent with no
 * session. Spending it schedules the purge a week on, as a runner's own
 * request does (`./deletion.ts`); signing in stays closed. An "Under 18"
 * closure schedules the deletion itself, with no link.
 *
 * **The link is an `email_verifications` row** (`purpose = 'delete'`):
 * a random secret, only its hash stored, one per account, so a second
 * cannot be sent while one is live and Reopen withdraws it by deleting
 * the row. Opening it reads and writes nothing; only the page's button
 * spends it (law 2, claim then work).
 *
 * **Who scheduled it is `account_deletions.cause`**: `asked` when the
 * runner used the link (or asked before they were closed), `under_18`
 * when the Desk closed the account for age. Reopen cancels the second
 * and never the first.
 */
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { drizzle } from "drizzle-orm/d1";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

import { user } from "../../../db/schema-auth";
import {
  accountDeletions,
  emailVerifications,
  userProfiles,
} from "../../../db/schema-core";
import { DELETION_GRACE_S, DELETION_LINK_TTL_S } from "../../../lib/contracts";
import type { ViewerZone } from "../../../lib/dates";
import { guarded, runGuarded } from "../../../lib/sql/batch-guard";
import { firstColumnWhere, firstRowWhere } from "../../../lib/sql/keyed-read";
import type { OutboxMessageOf } from "../../../lib/sql/outbox";
import { nowSeconds } from "../../../lib/now";
import { deliverEmail, emailDebt, type EmailDeps } from "../../email";
import { viewerZone } from "../../notifications";
import { outboxInsertWhere, oweOutbox } from "../../ops/outbox";
import {
  claimFreshEmailLink,
  emailLinkSpend,
  readEmailLink,
  type ReadLink,
} from "../verification";
import {
  deletionDay,
  pendingDeletionOf,
  type DeletionEffects,
} from "./deletion";

type Db = ReturnType<typeof drizzle>;

const DELETE = ["delete"] as const;

/**
The page the deletion link opens.
*/
export function deletionLinkUrl(origin: string, token: string): string {
  return `${origin}/account/deletion?${new URLSearchParams({ token }).toString()}`;
}

interface ClosedAccount {
  readonly email: string;
  readonly handle: string | undefined;
}

/**
 * The account, while it is closed: its own address and its handle, if it
 * has one. Anything else — open, or gone — is `undefined`.
 */
async function closedAccountOf(
  db: Db,
  userId: string,
): Promise<ClosedAccount | undefined> {
  const [email, profile] = await Promise.all([
    firstColumnWhere(db, user, user.email, eq(user.id, userId)),
    firstRowWhere(db, userProfiles, eq(userProfiles.userId, userId)),
  ]);
  return email === undefined || typeof profile?.bannedAt !== "number"
    ? undefined
    : { email, handle: profile.username ?? undefined };
}

export type SendResult =
  | { readonly status: "sent"; readonly expiresAt: number }
  | { readonly status: "refused" };

const REFUSED: SendResult = { status: "refused" };

/**
 * The Desk's "Send deletion link" (round 64 #372): for a closed account
 * with no deletion scheduled and no link live, a fresh link to its own
 * address. `db` is the primary's: this read authorises the write.
 *
 * The link goes straight after the write, never through the outbox,
 * which would hold the live link (as the confirm links). A send that
 * fails withdraws this link, so the Desk's row reads NOT SENT and the
 * next press sends a fresh one (law 8c): the error is the operator's to
 * see.
 */
export async function sendDeletionLink(
  db: Db,
  userId: string,
  deps: EmailDeps,
  now = nowSeconds(),
): Promise<SendResult> {
  const account = await closedAccountOf(db, userId);
  if (
    account === undefined ||
    (await pendingDeletionOf(db, userId)) !== undefined
  ) {
    return REFUSED;
  }
  const token = await claimFreshEmailLink(
    db,
    { userId, purpose: "delete", email: account.email },
    now,
  );
  if (token === undefined) return REFUSED;
  const expiresAt = now + DELETION_LINK_TTL_S;
  const until = deletionDay(expiresAt, await viewerZone(db, userId));
  try {
    await deliverEmail(
      db,
      {
        to: { userId },
        template: {
          kind: "deletion_link",
          url: deletionLinkUrl(deps.origin, token),
          until,
          handle: account.handle,
        },
      },
      deps,
    );
  } catch (error) {
    // This press's link: while it was live, no other could be written.
    await db.delete(emailVerifications).where(deleteLinkOf(userId));
    throw error;
  }
  return { status: "sent", expiresAt };
}

function deleteLinkOf(userId: string): SQL {
  return sql`${eq(emailVerifications.userId, userId)} AND ${eq(emailVerifications.purpose, "delete")}`;
}

/**
 * The link's page (round 64 #374.3): the ask while the link can be spent,
 * what it did once it has, or that it doesn't work. `handle` is absent
 * for a runner closed before they picked one.
 */
export type DeletionLanding =
  | {
      readonly state: "ask";
      readonly handle: string | undefined;
      readonly day: string;
    }
  | { readonly state: "done"; readonly day: string }
  | { readonly state: "used"; readonly day: string }
  | { readonly state: "expired" };

const EXPIRED: DeletionLanding = { state: "expired" };

/**
 * The guard on the link's spend, which a press that lost the race misses.
 */
const SPENT = "link-spent";

/**
A link that can still be spent, with what its page says about the account.
*/
interface Spendable {
  readonly link: ReadLink<"delete">;
  readonly zone: ViewerZone;
  readonly handle: string | undefined;
}

/**
 * The link while it can be spent, or the page it ends on. A bad token, an
 * account that is open again or gone, a link that ran out, or one Reopen
 * withdrew all end on the same page (LINK EXPIRED), so it tells nobody
 * which.
 */
async function spendableOrEnd(
  db: Db,
  token: unknown,
  now: number,
): Promise<Spendable | DeletionLanding> {
  const link = await readEmailLink(db, token, DELETE);
  if (link === undefined) return EXPIRED;
  const account = await closedAccountOf(db, link.userId);
  if (account === undefined) return EXPIRED;
  const zone = await viewerZone(db, link.userId);
  if (link.usedAt !== undefined) {
    return usedEnd(await pendingDeletionOf(db, link.userId), zone);
  }
  return now < link.expiresAt
    ? { link, zone, handle: account.handle }
    : EXPIRED;
}

/**
 * A spent link's page: the day its deletion lands, while it is pending.
 */
function usedEnd(
  pending: { purgeAfter: number } | undefined,
  zone: ViewerZone,
): DeletionLanding {
  return pending === undefined
    ? EXPIRED
    : { state: "used", day: deletionDay(pending.purgeAfter, zone) };
}

/**
 * The page as it opens: claims nothing and writes nothing, so a scanner
 * or a preview fetching the link spends nothing.
 */
export async function readDeletionLanding(
  db: Db,
  token: unknown,
  now = nowSeconds(),
): Promise<DeletionLanding> {
  const found = await spendableOrEnd(db, token, now);
  return "state" in found
    ? found
    : {
        state: "ask",
        handle: found.handle,
        day: deletionDay(now + DELETION_GRACE_S, found.zone),
      };
}

/**
What spending the link does after it lands: the email sent, Strava disconnected.
*/
export type DeletionLinkEffects = Pick<
  DeletionEffects,
  "keepAlive" | "report" | "settle" | "disconnectStrava"
>;

/**
 * "Delete my account": one batch that spends the link (law 2), schedules
 * the purge a week on — only while the account is still closed — and owes
 * the delete-scheduled email (law 8c, round 64 #374.4). The spend and the
 * schedule are guarded, so they land together or not at all: a batch that
 * fails spends nothing, and the next press tries again. Two presses at
 * once schedule once; the other reads "already used". `db` is the
 * primary's.
 */
export async function confirmDeletionLink(
  db: Db,
  token: unknown,
  effects: DeletionLinkEffects,
  now = nowSeconds(),
): Promise<DeletionLanding> {
  const found = await spendableOrEnd(db, token, now);
  if ("state" in found) return found;
  const { link, zone } = found;
  const { userId } = link;
  const purgeAfter = now + DELETION_GRACE_S;
  const day = deletionDay(purgeAfter, zone);
  const debt = oweOutbox(
    emailDebt(
      {
        to: { userId },
        template: { kind: "deletion_scheduled", day, closed: true },
      },
      { dedupeKey: `deletion_scheduled:${userId}:${String(purgeAfter)}` },
    ),
  );
  // The claim this batch writes, and no earlier one.
  const scheduled = sql`${eq(accountDeletions.userId, userId)} AND ${eq(accountDeletions.requestedAt, now)}`;
  const written = await runGuarded(db, [
    ...guarded(db, emailLinkSpend(db, link, now), SPENT),
    ...guarded(
      db,
      deletionWhileClosed(db, { userId, requestedAt: now, purgeAfter }),
      "still-closed",
    ),
    outboxInsertWhere(
      db,
      debt,
      { table: accountDeletions, where: scheduled },
      now,
    ),
  ]);
  if (!written.ok) {
    // Spent by another press since the read, which reads "already used";
    // or reopened since the read, which scheduled nothing.
    return written.missed === SPENT
      ? readDeletionLanding(db, token, now)
      : EXPIRED;
  }
  effects.keepAlive(effects.settle(db, debt, effects.report));
  // Secondary to the deletion (law 5), as a runner's own request is.
  try {
    await effects.disconnectStrava(userId);
  } catch (error) {
    effects.report(error, { surface: "deletion-link-strava", userId });
  }
  return { state: "done", day };
}

/**
 * The deletion's claim, written only while the account is still closed:
 * the columns in the table's order, from the profile's row.
 */
function deletionWhileClosed(
  db: Db,
  row: Readonly<{ userId: string; requestedAt: number; purgeAfter: number }>,
) {
  return db
    .insert(accountDeletions)
    .select(
      sql`select ${row.userId}, ${row.requestedAt}, ${row.purgeAfter}, null, ${"asked"} from ${userProfiles} where ${eq(userProfiles.userId, row.userId)} and ${userProfiles.bannedAt} is not null`,
    )
    .onConflictDoNothing()
    .returning({ userId: accountDeletions.userId });
}

/**
 * An "Under 18" closure (round 64 #373): the deletion scheduled in the
 * closure's own batch, with no link, and the age email (#374.2) in place
 * of the closure email. A runner who had asked already keeps their own
 * date and cause, and the email says that date. `isForAge` false is
 * every other closure, which schedules nothing and leaves the email to
 * the ban's.
 */
export interface AgeClosure {
  readonly writes: (database: Db) => BatchItem<"sqlite">[];
  readonly email: OutboxMessageOf<"email"> | undefined;
}

export async function ageClosure(
  db: Db,
  userId: string,
  isForAge: boolean,
  now = nowSeconds(),
): Promise<AgeClosure> {
  if (!isForAge) return { writes: () => [], email: undefined };
  const pending = await pendingDeletionOf(db, userId);
  const purgeAfter = pending?.purgeAfter ?? now + DELETION_GRACE_S;
  const stored = await firstColumnWhere(
    db,
    userProfiles,
    userProfiles.username,
    eq(userProfiles.userId, userId),
  );
  const handle = stored ?? undefined;
  const day = deletionDay(purgeAfter, await viewerZone(db, userId));
  return {
    writes: (database) => [
      database
        .insert(accountDeletions)
        .values({ userId, requestedAt: now, purgeAfter, cause: "under_18" })
        .onConflictDoNothing(),
    ],
    email: emailDebt(
      {
        to: { userId },
        template: {
          kind: "account_closed_age",
          day,
          ...(handle !== undefined && { handle }),
        },
      },
      // The closure email's key: one closure email per runner.
      { dedupeKey: `account_closed:${userId}` },
    ),
  };
}

/**
 * What stops Reopen (owner, 2026-11-27): a deletion the runner chose —
 * through the link, or before the account was closed — or a purge that
 * has started. As SQL, for the lift's own `WHERE`.
 */
export function reopenHeldBy(userId: string): SQL {
  const held = and(
    eq(accountDeletions.userId, userId),
    or(
      eq(accountDeletions.cause, "asked"),
      sql`${accountDeletions.purgeStartedAt} IS NOT NULL`,
    ),
  );
  return sql`EXISTS (SELECT 1 FROM ${accountDeletions} WHERE ${held})`;
}

/**
 * What a Reopen also undoes, in its batch and only where it reopens
 * (`reopening`, the lift's own condition): an age closure's deletion that
 * has not started ("Reopening before then also cancels the deletion."),
 * and any deletion link ("Reopening cancels it.").
 */
export function reopenDeletionWrites(
  db: Db,
  userId: string,
  reopening: Readonly<{ table: SQLiteTable; where: SQL }>,
): BatchItem<"sqlite">[] {
  const reopens = sql`EXISTS (SELECT 1 FROM ${reopening.table} WHERE ${reopening.where})`;
  return [
    db
      .delete(accountDeletions)
      .where(
        and(
          eq(accountDeletions.userId, userId),
          eq(accountDeletions.cause, "under_18"),
          isNull(accountDeletions.purgeStartedAt),
          reopens,
        ),
      ),
    db
      .delete(emailVerifications)
      .where(sql`${deleteLinkOf(userId)} AND ${reopens}`),
  ];
}

/**
 * Each listed account's deletion link, for the Desk's panel: when it
 * runs out, and whether it was used. One read over a chunk of ids, on
 * the `(user_id, purpose)` index.
 */
export interface DeletionLinkState {
  readonly expiresAt: number;
  readonly isUsed: boolean;
}

export async function deletionLinksOf(
  db: Db,
  userIds: readonly string[],
): Promise<[string, DeletionLinkState][]> {
  const rows = await db
    .select({
      userId: emailVerifications.userId,
      expiresAt: emailVerifications.expiresAt,
      usedAt: emailVerifications.usedAt,
    })
    .from(emailVerifications)
    .where(
      and(
        inArray(emailVerifications.userId, [...userIds]),
        eq(emailVerifications.purpose, "delete"),
      ),
    );
  return rows.map((row) => [
    row.userId,
    { expiresAt: row.expiresAt, isUsed: row.usedAt !== null },
  ]);
}
