/**
 * Server-function glue: zod-validates every input, resolves the session,
 * then delegates. Route files import from here and only from here — no
 * business logic lives in `src/routes/safety/`.
 *
 * Nothing in this file can be imported by a test (D-41: `createServerFn`
 * drags TanStack Start's virtual entries in with it), which is why the
 * schemas live in `./inputs` and every decision lives in a sibling that a
 * test can reach.
 */
import { createServerFn } from "@tanstack/react-start";

import { requireUserId } from "../auth";

import { requireAdmin } from "./admin";
import { drizzle } from "drizzle-orm/d1";

import { env } from "../../env";

import { banUser, unbanUser } from "./bans";
import { forceRename } from "./rename";
import { accountCount, deskRunners } from "./runners";
import { blockRunner, blockedRunners, unblockRunner } from "./blocks";
import { denyDomain } from "./denylist";
import {
  banUserInput,
  blockRunnerInput,
  denyDomainInput,
  fileReportInput,
  forceRenameInput,
  reviewDecisionInput,
  runnersFilterInput,
  unbanUserInput,
} from "./inputs";
import { fileReport } from "./reports";
import { claimForReview, pendingReviewQueue } from "./review";

export const fileReportAction = createServerFn({ method: "POST" })
  .validator((input: unknown) => fileReportInput.parse(input))
  .handler(async ({ data }) => {
    const reporterId = await requireUserId();
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
    requireAdmin(await requireUserId());
    return { queue: await pendingReviewQueue() };
  },
);

export const claimReviewAction = createServerFn({ method: "POST" })
  .validator((input: unknown) => reviewDecisionInput.parse(input))
  .handler(async ({ data }) => {
    const reviewerId = requireAdmin(await requireUserId());
    return { outcome: await claimForReview(data.queueId, reviewerId) };
  });

export const banUserAction = createServerFn({ method: "POST" })
  .validator((input: unknown) => banUserInput.parse(input))
  .handler(async ({ data }) => {
    const bannedBy = requireAdmin(await requireUserId());
    await banUser({ userId: data.userId, reason: data.reason, bannedBy });
    return { banned: true };
  });

export const denyDomainAction = createServerFn({ method: "POST" })
  .validator((input: unknown) => denyDomainInput.parse(input))
  .handler(async ({ data }) => {
    const addedBy = requireAdmin(await requireUserId());
    await denyDomain(data.domain, addedBy, data.reason);
    return { denied: true };
  });

export const unbanUserAction = createServerFn({ method: "POST" })
  .validator((input: unknown) => unbanUserInput.parse(input))
  .handler(async ({ data }) => {
    const unbannedBy = requireAdmin(await requireUserId());
    await unbanUser(data.userId, unbannedBy);
    return { banned: false };
  });

/**
Round 27 #16: the handle becomes `@runner_NNNN`, with a reason.
*/
export const forceRenameAction = createServerFn({ method: "POST" })
  .validator((input: unknown) => forceRenameInput.parse(input))
  .handler(async ({ data }) => {
    const actorId = requireAdmin(await requireUserId());
    return forceRename(drizzle(env.DIALED_CORE), { ...data, actorId });
  });

/**
Desk · Runners, "D8" (round 27 #22).
*/
export const deskRunnersQuery = createServerFn({ method: "GET" })
  .validator((input: unknown) => runnersFilterInput.parse(input))
  .handler(async ({ data }) => {
    requireAdmin(await requireUserId());
    const db = drizzle(env.DIALED_CORE);
    return {
      runners: await deskRunners(db, data),
      total: await accountCount(db),
    };
  });
