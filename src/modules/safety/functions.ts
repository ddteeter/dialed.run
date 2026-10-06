/**
 * Server-function glue: zod-validates every input, resolves the session,
 * then delegates. Route files import from here and only from here — no
 * business logic lives in `src/routes/safety/`.
 *
 * Nothing in this file can be imported by a test (R-41: `createServerFn`
 * drags TanStack Start's virtual entries in with it), which is why the
 * schemas live in `./inputs` and every decision lives in a sibling that a
 * test can reach.
 */
import { createServerFn } from "@tanstack/react-start";

import { requireUserId, verifiedUserId } from "../auth";

import { requireAdmin } from "./admin";
import { drizzle } from "drizzle-orm/d1";

import { env } from "../../env";
import {
  outboxInsert,
  outboxInsertWhere,
  oweOutbox,
  settleOutbox,
} from "../ops";

import { banEmail, banUser, reopenEmailFor, unbanUser } from "./bans";
import {
  accountCount,
  forceRename,
  listAccounts,
  reviewFlaggedHandle,
} from "../account";
import { placeholderHandle, renameRecord } from "./rename";
import { deskRunners, runnersWhere } from "./runners";
import { blockRunner, blockedRunners, unblockRunner } from "./blocks";
import { denyDomain } from "./denylist";
import {
  banUserInput,
  blockRunnerInput,
  denyDomainInput,
  fileReportInput,
  forceRenameInput,
  handleReviewInput,
  reviewDecisionInput,
  runnersFilterInput,
  unbanUserInput,
} from "./inputs";
import { fileReport } from "./reports";
import { claimForReview, pendingReviewQueue } from "./review";

export const fileReportAction = createServerFn({ method: "POST" })
  .validator((input: unknown) => fileReportInput.parse(input))
  .handler(async ({ data }) => {
    // Waits for a confirmed address (seam 7; D-113): the gate says so.
    const reporterId = await verifiedUserId();
    // The block rides with the report (W1's checkbox) rather than being a
    // second round trip the reporter could lose; `fileReport` owns that
    // decision, because a route may not branch.
    return fileReport({ reporterId, ...data });
  });

export const blockRunnerAction = createServerFn({ method: "POST" })
  .validator((input: unknown) => blockRunnerInput.parse(input))
  .handler(async ({ data }) => {
    const blockerId = await requireUserId();
    await blockRunner(blockerId, data.userId);
    return { blocked: true };
  });

export const unblockRunnerAction = createServerFn({ method: "POST" })
  .validator((input: unknown) => blockRunnerInput.parse(input))
  .handler(async ({ data }) => {
    const blockerId = await requireUserId();
    await unblockRunner(blockerId, data.userId);
    return { blocked: false };
  });

export const blockedRunnersQuery = createServerFn({ method: "GET" }).handler(
  async () => {
    const blockerId = await requireUserId();
    return { blocked: await blockedRunners(blockerId) };
  },
);

export const reviewQueueQuery = createServerFn({ method: "GET" }).handler(
  async () => {
    requireAdmin(await verifiedUserId());
    return { queue: await pendingReviewQueue() };
  },
);

export const claimReviewAction = createServerFn({ method: "POST" })
  .validator((input: unknown) => reviewDecisionInput.parse(input))
  .handler(async ({ data }) => {
    const reviewerId = requireAdmin(await verifiedUserId());
    return { outcome: await claimForReview(data.queueId, reviewerId) };
  });

export const banUserAction = createServerFn({ method: "POST" })
  .validator((input: unknown) => banUserInput.parse(input))
  .handler(async ({ data }) => {
    const bannedBy = requireAdmin(await verifiedUserId());
    const ban = { userId: data.userId, reason: data.reason, bannedBy };
    // The ban's email, owed in the ban's batch, then the fast path.
    const debt = oweOutbox(banEmail(ban));
    await banUser(ban, (database) => [outboxInsert(database, debt)]);
    await settleOutbox(drizzle(env.DIALED_CORE), debt);
    return { banned: true };
  });

export const denyDomainAction = createServerFn({ method: "POST" })
  .validator((input: unknown) => denyDomainInput.parse(input))
  .handler(async ({ data }) => {
    const addedBy = requireAdmin(await verifiedUserId());
    await denyDomain(data.domain, addedBy, data.reason);
    return { denied: true };
  });

export const unbanUserAction = createServerFn({ method: "POST" })
  .validator((input: unknown) => unbanUserInput.parse(input))
  .handler(async ({ data }) => {
    const unbannedBy = requireAdmin(await verifiedUserId());
    // D-89's reopen email, naming the handle (round 29 #7): owed in the
    // lift's batch only while the account is still closed, and sent by the
    // fast path only when the lift reopened it (`unbanUser`).
    const debt = oweOutbox(await reopenEmailFor(data.userId));
    await unbanUser(data.userId, unbannedBy, {
      owe: (database, stillBanned) =>
        outboxInsertWhere(database, debt, stillBanned),
      settle: () => settleOutbox(drizzle(env.DIALED_CORE), debt),
    });
    return { banned: false };
  });

/**
 * A review row about a handle the re-ask flagged (D-97): Keep, which
 * clears the flag, or Rename, the force-rename below with its reasons.
 * Admin-only; the decision lives in `account/handle-review.ts`.
 */
export const reviewHandleAction = createServerFn({ method: "POST" })
  .validator((input: unknown) => handleReviewInput.parse(input))
  .handler(async ({ data }) => {
    const reviewerId = requireAdmin(await verifiedUserId());
    return {
      outcome: await reviewFlaggedHandle(
        drizzle(env.DIALED_CORE),
        reviewerId,
        data,
      ),
    };
  });

/**
Round 27 #16: the handle becomes `@runner_NNNN`, with a reason.
*/
export const forceRenameAction = createServerFn({ method: "POST" })
  .validator((input: unknown) => forceRenameInput.parse(input))
  .handler(async ({ data }) => {
    const actorId = requireAdmin(await verifiedUserId());
    const db = drizzle(env.DIALED_CORE);
    return forceRename(db, {
      userId: data.userId,
      typed: placeholderHandle(),
      reason: data.nameReason,
      recordedAs: renameRecord(db, {
        userId: data.userId,
        actorId,
        reason: data.nameReason,
      }),
    });
  });

/**
Desk · Runners, "D8" (round 27 #22).
*/
export const deskRunnersQuery = createServerFn({ method: "GET" })
  .validator((input: unknown) => runnersFilterInput.parse(input))
  .handler(async ({ data }) => {
    requireAdmin(await verifiedUserId());
    const db = drizzle(env.DIALED_CORE);
    const accounts = await listAccounts(db, {
      query: data.query,
      only: runnersWhere(data.filter),
    });
    return {
      runners: await deskRunners(db, accounts),
      total: await accountCount(db),
    };
  });
