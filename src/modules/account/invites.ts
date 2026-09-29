/**
 * Invite codes (task 126, ACC-5; decision D-39; round 26 #20): whether a
 * code is open, spending one on a new account, and Desk D7's writes —
 * minting, answering a request, revoking and its undo.
 *
 * The code's shape and its words are `lib/access.ts`'s; the gate that
 * calls these at sign-up is `modules/auth/access-hook.ts`.
 */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";

import { user } from "../../db/schema-auth";
import {
  accessRequests,
  inviteCodes,
  inviteRedemptions,
  outbox,
  userProfiles,
} from "../../db/schema-core";
import { mintInviteCode } from "../../lib/access";
import { newUlid } from "../../lib/ids";
import { firstColumnWhere } from "../../lib/keyed-read";
import { nowSeconds } from "../../lib/now";
import { orSqlNull } from "../../lib/sql-null";
import { emailDebt } from "../email";
import { outboxInsert, oweOutbox, type OutboxDebt } from "../ops";
import type { OwedMail } from "./verification";

type Db = ReturnType<typeof drizzle>;

/**
 * One column, one row, for a `db.batch()` statement — never awaited here,
 * so the caller decides whether it rides a batch or is awaited alone.
 *
 * `claimFor` and `codeOfRequestStatement` had each written this out: select
 * one column, filtered to one row by `LIMIT 1`. `lib/keyed-read.ts`'s
 * `firstColumnWhere` is the same read already awaited — not reusable here
 * because these two are batch statements, and awaiting one before `batch()`
 * sees it would run it outside the transaction it needs to land in.
 */
function selectOneWhere<TColumn extends SQLiteColumn>(
  db: Db,
  table: SQLiteTable,
  column: TColumn,
  where: SQL,
) {
  return db.select({ value: column }).from(table).where(where).limit(1);
}

/**
 * How long a claim holds its use of a code before the account it was for
 * exists. Better Auth writes the account a few milliseconds after the
 * claim; ten minutes is for a Worker that died between the two, after
 * which the use comes back.
 */
export const CLAIM_HOLD_S = 10 * 60;

export type InviteStanding = "open" | "used" | "invalid";
export type InviteClaim = "redeemed" | "used" | "invalid";

/**
 * A redemption that still counts against its code: it was confirmed (its
 * account arrived — and stays counted if that account is later deleted),
 * an account holds its address, or its hold is live. Correlated on
 * `invite_redemptions`' own columns.
 *
 * By address, not by the claim's own user id: a retried sign-up mints a
 * new id, so the account that wins may be either attempt's, and the use
 * is the address's whichever it was.
 */
function stillCounts(now: number): SQL {
  return sql`(${inviteRedemptions.confirmedAt} IS NOT NULL OR ${inviteRedemptions.heldUntil} > ${now} OR EXISTS (SELECT 1 FROM ${user} WHERE ${user.email} = ${inviteRedemptions.email}))`;
}

/**
 * How many of a code's uses are spent (see `stillCounts`): one per
 * address, so an address's second claim — a retry — is not a second use.
 */
function usesOf(codeId: SQL | typeof inviteCodes.id, now: number): SQL {
  return sql`(SELECT count(DISTINCT ${inviteRedemptions.email}) FROM ${inviteRedemptions} WHERE ${inviteRedemptions.codeId} = ${codeId} AND ${stillCounts(now)})`;
}

/**
 * Whether `code` (already normalized) would let an account in: `invalid`
 * for no such code or a revoked one, and `used` when its uses are spent.
 * The sign-up form answers `used` and `invalid` with the same sentence
 * (`INVITE_COPY.invalid`), so a prober learns nothing from which.
 */
export async function inviteStanding(
  db: Db,
  code: string,
  now = nowSeconds(),
): Promise<InviteStanding> {
  const [row] = await db
    .select({
      revokedAt: inviteCodes.revokedAt,
      maxUses: inviteCodes.maxUses,
      uses: usesOf(inviteCodes.id, now).mapWith(Number),
    })
    .from(inviteCodes)
    .where(eq(inviteCodes.code, code))
    .limit(1);
  if (row?.revokedAt !== null) return "invalid";
  return row.uses < row.maxUses ? "open" : "used";
}

/**
 * Spends `code` on the account about to be made as `userId` — the claim
 * the user create hook makes, before Better Auth writes the row.
 *
 * **Nothing is deleted.** A retried sign-up (the same address, a new id)
 * writes a second claim beside its first, and `usesOf` counts the address
 * once, so the retry is not refused by its own earlier attempt — and an
 * attempt still in flight keeps its claim, whichever of the two makes the
 * account. The claim is one conditional insert, so two sign-ups from
 * different addresses racing for a single-use code cannot both land: D1
 * runs them one after the other, and the second sees the first's hold.
 * The read after it, in the same batch, says whether this one did.
 */
export async function redeemInvite(
  db: Db,
  claim: Readonly<{ code: string; userId: string; email: string }>,
  now = nowSeconds(),
): Promise<InviteClaim> {
  const email = claim.email.toLowerCase();
  const results = await db.batch([
    claimUse(db, { ...claim, email }, now),
    claimFor(db, claim.userId),
  ]);
  if (results[1].length > 0) return "redeemed";
  const standing = await inviteStanding(db, claim.code, now);
  // Open now but not claimed a moment ago is a hold that ran out in
  // between: it was spent when this claim ran.
  return standing === "invalid" ? "invalid" : "used";
}

/**
 * The claim: one row, written only if the code is live and has a use
 * left for this address — a use left, or this address's own live claim
 * on it already — the condition and the write are one statement.
 */
function claimUse(
  db: Db,
  claim: Readonly<{ code: string; userId: string; email: string }>,
  now: number,
) {
  const useLeft = sql`${usesOf(inviteCodes.id, now)} < ${inviteCodes.maxUses}`;
  const retry = sql`EXISTS (SELECT 1 FROM ${inviteRedemptions} WHERE ${inviteRedemptions.codeId} = ${inviteCodes.id} AND ${inviteRedemptions.email} = ${claim.email} AND ${inviteRedemptions.confirmedAt} IS NULL AND ${inviteRedemptions.heldUntil} > ${now})`;
  return db
    .insert(inviteRedemptions)
    .select(
      sql`SELECT ${claim.userId}, ${inviteCodes.id}, ${claim.email}, ${now + CLAIM_HOLD_S}, ${now}, NULL FROM ${inviteCodes} WHERE ${inviteCodes.code} = ${claim.code} AND ${inviteCodes.revokedAt} IS NULL AND (${useLeft} OR ${retry})`,
    );
}

function claimFor(db: Db, userId: string) {
  return selectOneWhere(
    db,
    inviteRedemptions,
    inviteRedemptions.userId,
    eq(inviteRedemptions.userId, userId),
  );
}

/**
 * The account a claim was for exists: the claim is a use for good. Called
 * from the user create hook's `after`, so deleting the account later
 * (PR 2b-2) never hands a single-use code back. Until it runs, the
 * account's address is what counts the use (`stillCounts`).
 */
export function confirmRedemption(db: Db, userId: string, now = nowSeconds()) {
  const unconfirmed = and(
    eq(inviteRedemptions.userId, userId),
    isNull(inviteRedemptions.confirmedAt),
  );
  // Unsent: the caller awaits it (the gate's `confirm`), or batches it.
  return db
    .update(inviteRedemptions)
    .set({ confirmedAt: now })
    .where(unconfirmed);
}

/**
One row of D7's Codes list.
*/
export interface DeskCode {
  readonly id: string;
  readonly code: string;
  readonly label: string | null;
  readonly maxUses: number;
  readonly createdAt: number;
  readonly isRevoked: boolean;
  /**
   * Who spent it, oldest first: their `@handle`, or the account's email
   * before O0 is finished (round 26 #20).
   */
  readonly usedBy: readonly string[];
}

/**
One row of D7's Requests list.
*/
export interface DeskRequest {
  readonly id: string;
  readonly email: string;
  readonly note: string | null;
  readonly createdAt: number;
}

export interface AccessDesk {
  readonly requests: readonly DeskRequest[];
  readonly codes: readonly DeskCode[];
}

/**
 * How many rows either list shows. The Desk is one operator's tool and
 * the invite stage is friends (D-38); past this, the oldest requests and
 * the newest codes are the ones that matter.
 */
export const DESK_LIST_LIMIT = 200;

/**
 * D7 Access: pending requests oldest first, and codes newest first with
 * who spent them. One batch of three reads; the used-by rows are grouped
 * onto their codes in code, which is a join's shape and not a filter.
 */
function listedCodeIds(db: Db) {
  return db
    .select({ id: inviteCodes.id })
    .from(inviteCodes)
    .orderBy(desc(inviteCodes.createdAt))
    .limit(DESK_LIST_LIMIT);
}

/**
Who spent a use: their `@handle`, or their email before O0.
*/
function spender(row: { username: string | null; email: string }): string {
  return row.username === null ? row.email : `@${row.username}`;
}

export async function accessDesk(db: Db): Promise<AccessDesk> {
  const listed = inArray(inviteRedemptions.codeId, listedCodeIds(db));
  const [requests, codes, spent] = await db.batch([
    db
      .select({
        id: accessRequests.id,
        email: accessRequests.email,
        note: accessRequests.note,
        createdAt: accessRequests.createdAt,
      })
      .from(accessRequests)
      .where(eq(accessRequests.status, "pending"))
      .orderBy(accessRequests.createdAt)
      .limit(DESK_LIST_LIMIT),
    db
      .select({
        id: inviteCodes.id,
        code: inviteCodes.code,
        label: inviteCodes.label,
        maxUses: inviteCodes.maxUses,
        createdAt: inviteCodes.createdAt,
        revokedAt: inviteCodes.revokedAt,
      })
      .from(inviteCodes)
      .orderBy(desc(inviteCodes.createdAt))
      .limit(DESK_LIST_LIMIT),
    // Only accounts that exist — a claim whose account never arrived
    // spent nothing anybody can name — and only for the codes listed.
    db
      .select({
        codeId: inviteRedemptions.codeId,
        username: userProfiles.username,
        email: user.email,
      })
      .from(inviteRedemptions)
      .innerJoin(user, eq(user.id, inviteRedemptions.userId))
      .leftJoin(userProfiles, eq(userProfiles.userId, inviteRedemptions.userId))
      .where(listed)
      .orderBy(inviteRedemptions.redeemedAt),
  ]);
  return {
    requests,
    codes: codes.map(({ revokedAt, ...code }) => ({
      ...code,
      isRevoked: revokedAt !== null,
      usedBy: spent
        .filter((row) => row.codeId === code.id)
        .map((row) => spender(row)),
    })),
  };
}

function codeMadeBy(db: Db, operatorId: string, idempotencyKey: string) {
  const mine = and(
    eq(inviteCodes.createdBy, operatorId),
    eq(inviteCodes.idempotencyKey, idempotencyKey),
  );
  return db
    .select({ code: inviteCodes.code })
    .from(inviteCodes)
    .where(mine)
    .limit(1);
}

/**
 * D7's New code: a code with a label and a uses limit. Idempotent on the
 * form's key, scoped to the operator (law 8b): a repeat returns the code
 * the first submit minted.
 */
export async function createInviteCode(
  db: Db,
  input: Readonly<{
    operatorId: string;
    label: string;
    maxUses: number;
    idempotencyKey: string;
  }>,
  now = nowSeconds(),
): Promise<{ code: string }> {
  const results = await db.batch([
    db
      .insert(inviteCodes)
      .values({
        id: newUlid(),
        code: mintInviteCode(),
        label: input.label === "" ? undefined : input.label,
        maxUses: input.maxUses,
        createdBy: input.operatorId,
        idempotencyKey: input.idempotencyKey,
        createdAt: now,
      })
      // Untargeted: a repeat of the form's key writes nothing, and so
      // does a fresh code that collides with an existing one (one in
      // 32^4) — which the read then finds missing, and says so.
      .onConflictDoNothing(),
    codeMadeBy(db, input.operatorId, input.idempotencyKey),
  ]);
  const [row] = results[1];
  if (row === undefined) throw new Error("invite code was not created");
  return row;
}

/**
 * D7's Send invite: mints a single-use code for a pending request,
 * labelled "{address} (request)" as the board draws it, and moves the
 * request to invited — one batch, and a second press returns the code the first one minted
 * (`invite_codes.request_id` is unique).
 *
 * **The email that carries it** ("Your dialed.run invite", round 26 #20)
 * is owed in the same batch (law 8c) and sent after the answer, through
 * the outbox. The code is minted before the batch so the email can name
 * it; if another press won the race for this request, this batch's code
 * was never stored, and the same batch withdraws its email — so no email
 * ever carries a code that does not exist.
 */
export async function inviteFromRequest(
  db: Db,
  input: Readonly<{ operatorId: string; requestId: string }>,
  owed: OwedMail,
  now = nowSeconds(),
): Promise<{ code: string } | undefined> {
  const requested = await firstColumnWhere(
    db,
    accessRequests,
    accessRequests.email,
    and(
      eq(accessRequests.id, input.requestId),
      eq(accessRequests.status, "pending"),
    ),
  );
  if (requested === undefined) return codeOfRequest(db, input.requestId);
  const code = mintInviteCode();
  const debt = oweOutbox(
    emailDebt(
      { to: { address: requested }, template: { kind: "invite", code } },
      { dedupeKey: `invite:${code}` },
    ),
  );
  const results = await db.batch([
    codeForRequest(db, input, code, now),
    markInvited(db, input.requestId, now),
    outboxInsert(db, debt, now),
    unlessStored(db, debt, code),
    codeOfRequestStatement(db, input.requestId),
  ]);
  const [minted] = results[4];
  if (minted?.value === code) {
    owed.keepAlive(owed.settle(db, debt, owed.report));
  }
  return minted === undefined ? undefined : { code: minted.value };
}

function codeOfRequestStatement(db: Db, requestId: string) {
  return selectOneWhere(
    db,
    inviteCodes,
    inviteCodes.code,
    eq(inviteCodes.requestId, requestId),
  );
}

/**
 * The code an answered request already has — a second press, or a
 * request somebody else answered first.
 */
async function codeOfRequest(
  db: Db,
  requestId: string,
): Promise<{ code: string } | undefined> {
  const [row] = await codeOfRequestStatement(db, requestId);
  return row === undefined ? undefined : { code: row.value };
}

/**
 * Withdraws this batch's invite email when its code did not land — another
 * press answered the request first. A statement in the same batch, so it
 * sees exactly what the insert before it did. It names the debt by its own
 * id, which only this batch wrote.
 */
function unlessStored(db: Db, debt: OutboxDebt, code: string) {
  return db
    .delete(outbox)
    .where(
      and(
        eq(outbox.id, debt.id),
        sql`not exists (select 1 from ${inviteCodes} where ${inviteCodes.code} = ${code})`,
      ),
    );
}

/**
 * A single-use code for a pending request, labelled as the board draws
 * it. Nothing for a request already answered; a second code for the same
 * request is refused by its unique index.
 */
function codeForRequest(
  db: Db,
  input: Readonly<{ operatorId: string; requestId: string }>,
  code: string,
  now: number,
) {
  const label = sql`${accessRequests.email} || ' (request)'`;
  return db
    .insert(inviteCodes)
    .select(
      sql`SELECT ${newUlid()}, ${code}, ${label}, 1, ${input.operatorId}, NULL, ${accessRequests.id}, ${now}, NULL FROM ${accessRequests} WHERE ${accessRequests.id} = ${input.requestId} AND ${accessRequests.status} = 'pending'`,
    )
    .onConflictDoNothing({ target: inviteCodes.requestId });
}

/**
A pending request, moved on — to invited, or declined.
*/
function markInvited(db: Db, requestId: string, now: number) {
  return settleRequest(db, requestId, "invited", now);
}

function settleRequest(
  db: Db,
  requestId: string,
  status: "invited" | "declined",
  now: number,
) {
  const pending = and(
    eq(accessRequests.id, requestId),
    eq(accessRequests.status, "pending"),
  );
  return db
    .update(accessRequests)
    .set({ status, updatedAt: now })
    .where(pending);
}

/**
 * D7's Decline: silent (round 26 #20) — nobody is told, and the address
 * may ask again, which puts it back on the list.
 */
export async function declineRequest(
  db: Db,
  requestId: string,
  now = nowSeconds(),
): Promise<void> {
  await settleRequest(db, requestId, "declined", now);
}

/**
 * D7's Revoke: at once, no confirm (round 26 #20). The code stops working
 * for anyone who has not already spent it.
 */
export async function revokeInviteCode(
  db: Db,
  codeId: string,
  now = nowSeconds(),
): Promise<void> {
  await db
    .update(inviteCodes)
    .set({ revokedAt: now })
    .where(and(eq(inviteCodes.id, codeId), isNull(inviteCodes.revokedAt)));
}

/**
Revoke's undo: the code works again.
*/
export async function restoreInviteCode(db: Db, codeId: string): Promise<void> {
  await db
    .update(inviteCodes)
    .set({ revokedAt: orSqlNull(undefined) })
    .where(eq(inviteCodes.id, codeId));
}
