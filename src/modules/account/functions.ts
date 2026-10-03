/**
 * Server-fn glue for the account module (imported directly by route files,
 * per modules/auth's pattern) — keeps this module's other files loadable
 * in the vitest workers pool with no TanStack virtual entries.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { drizzle } from "drizzle-orm/d1";

import { env, waitUntil } from "../../env";
import { accountDeletionInput, usernameInput } from "../../lib/contracts";
import {
  checkCurrentPassword,
  currentSessionId,
  deploymentPosture,
  optionalUserId,
  requireSignedInSince,
  requireUserId,
  requireUserIdBeforeTerms,
  requireUserIdWhileLeaving,
} from "../auth";
import { nowSeconds } from "../../lib/now";
import { emailDepsFromEnv } from "../email";
import {
  captureException,
  settleOutbox,
  turnstileSiteKey,
  verifyTurnstileToken,
} from "../ops";
import { requireAdmin } from "../safety";
import { requestAccess, turnstileAttempt } from "./access";
import { accountPage, accountView } from "./account-view";
import { requestExport } from "./data-exports";
import {
  deletionEffectsFromEnv,
  keepAccount,
  leavingView,
  requestAccountDeletion,
} from "./deletion";
import {
  acceptTermsInput,
  changeEmailInput,
  confirmInput,
  deskRowInput,
  exportRequestInput,
  legalPageInput,
  newInviteInput,
  requestAccessInput,
  resendInput,
} from "./inputs";
import {
  accessDesk,
  createInviteCode,
  declineRequest,
  inviteFromRequest,
  restoreInviteCode,
  revokeInviteCode,
} from "./invites";
import { handleScreenFromEnv } from "./handle-screen";
import type { LegalSlug } from "./inputs";
import { legalPage } from "./legal";
import {
  homeIfNothingToSay,
  legalDocOrNotFound,
  leavingSearch,
} from "./route-decisions";
import { acceptTerms, termsPromptView } from "./terms-acceptance";
import { claimUsername, handleGate, usernameOf } from "./username";
import {
  confirmEmail,
  requestEmailChange,
  resendConfirmation,
} from "./verification";

function db() {
  return drizzle(env.DIALED_CORE);
}

/**
 * O0 and Settings › Username: claim a handle, or hear it is taken and what
 * is free instead.
 */
export const claimUsernameFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => usernameInput.parse(data))
  .handler(async ({ data }) =>
    claimUsername(
      db(),
      await requireUserId(),
      data.username,
      handleScreenFromEnv(captureException),
    ),
  );

/**
 * The signed-in runner's handle, or nothing before O0 — for the settings
 * row and Settings › Username.
 */
export const usernameQuery = createServerFn({ method: "GET" }).handler(
  async () => ({ username: await usernameOf(db(), await requireUserId()) }),
);

/**
 * Whether the root route should send this visitor to O0 before anything
 * else — see `handleGate` for the three answers.
 */
export const handleGateQuery = createServerFn({ method: "GET" }).handler(
  async () => handleGate(db(), await optionalUserId()),
);

/**
 * The account's settings pages (ACC-7, ACC-8, ACC-11): the account, the
 * handle and the email switches. Before the terms: Settings › Account is
 * where a runner who will not accept them deletes their account.
 */
export const accountPageQuery = createServerFn({ method: "GET" }).handler(
  async () => accountPage(db(), await requireUserIdBeforeTerms()),
);

/**
 * The same, for a page a signed-out visitor may also be on (Au4):
 * `undefined` when nobody is signed in.
 */
export const optionalAccountQuery = createServerFn({ method: "GET" }).handler(
  async () => accountView(db(), await optionalUserId()),
);

/**
 * Au4's Resend link (round 26 #11). No session needed: the page answers
 * the same for any address, and the limit is per address.
 */
export const resendConfirmationFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => resendInput.parse(data))
  .handler(async ({ data }) =>
    resendConfirmation(db(), data.email, emailDepsFromEnv(), {
      keepAlive: waitUntil,
      report: captureException,
    }),
  );

/**
 * The confirm link's landing: spend the link, and say which of the three
 * landings to show. POST because it changes state; the landing's loader
 * calls it once.
 */
export const confirmEmailFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => confirmInput.parse(data))
  .handler(async ({ data }) =>
    confirmEmail(db(), data.token, {
      report: captureException,
      currentSessionId: await currentSessionId(),
    }),
  );

/**
 * ACC-8: send the link that moves the account to a new address, once the
 * current password is proved.
 */
export const requestEmailChangeFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => changeEmailInput.parse(data))
  .handler(async ({ data }) =>
    requestEmailChange(
      db(),
      {
        userId: await requireUserId(),
        newEmail: data.email,
        currentPassword: data.currentPassword,
        checkPassword: checkCurrentPassword,
      },
      emailDepsFromEnv(),
      { keepAlive: waitUntil, report: captureException, settle: settleOutbox },
    ),
  );

/**
 * Turnstile's public site key for Au2 and Au5's widget, or nothing when
 * the deployment has none (the widget then renders nothing).
 */
export const turnstileSiteKeyQuery = createServerFn({ method: "GET" }).handler(
  () => ({ siteKey: turnstileSiteKey() }),
);

/**
 * Au5 · Request access (ACC-5). No session: the visitor has no account.
 * The limit applies where Better Auth's does — a real, https deployment.
 */
export const requestAccessFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => requestAccessInput.parse(data))
  .handler(async ({ data }) =>
    requestAccess(
      db(),
      {
        email: data.email,
        note: data.note,
        attempt: turnstileAttempt(data.turnstileToken, getRequest()),
        isLimited: deploymentPosture(env.BETTER_AUTH_URL).rateLimited,
      },
      verifyTurnstileToken,
    ),
  );

/**
Desk D7 · Access: requests and codes, for an operator only.
*/
export const accessDeskQuery = createServerFn({ method: "GET" }).handler(
  async () => {
    requireAdmin(await requireUserId());
    return accessDesk(db());
  },
);

/**
D7's New code.
*/
export const createInviteCodeFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => newInviteInput.parse(data))
  .handler(async ({ data }) =>
    createInviteCode(db(), {
      operatorId: requireAdmin(await requireUserId()),
      label: data.label,
      maxUses: data.maxUses,
      idempotencyKey: data.idempotencyKey,
    }),
  );

/**
D7's Send invite, on a request.
*/
export const inviteFromRequestFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => deskRowInput.parse(data))
  .handler(async ({ data }) =>
    inviteFromRequest(
      db(),
      {
        operatorId: requireAdmin(await requireUserId()),
        requestId: data.id,
      },
      { keepAlive: waitUntil, report: captureException, settle: settleOutbox },
    ),
  );

/**
D7's Decline, on a request.
*/
export const declineRequestFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => deskRowInput.parse(data))
  .handler(async ({ data }) => {
    requireAdmin(await requireUserId());
    await declineRequest(db(), data.id);
  });

/**
D7's Revoke, on a code.
*/
export const revokeInviteCodeFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => deskRowInput.parse(data))
  .handler(async ({ data }) => {
    requireAdmin(await requireUserId());
    await revokeInviteCode(db(), data.id);
  });

/**
 * A legal page (ACC-13): its text if it is finished, and the bell's count
 * for a signed-in reader. No session needed — the policy is for anyone.
 */
const legalPageQuery = createServerFn({ method: "GET" })
  .validator((data: unknown) => legalPageInput.parse(data))
  .handler(async ({ data }) =>
    legalPage(db(), data.slug, await optionalUserId()),
  );

/**
Revoke's undo.
*/
export const restoreInviteCodeFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => deskRowInput.parse(data))
  .handler(async ({ data }) => {
    requireAdmin(await requireUserId());
    await restoreInviteCode(db(), data.id);
  });

/**
 * ACC-10's Get a copy: queue the runner's emailed ZIP, or nothing new if
 * one is under way or was made today — and what the row shows now. Before
 * the terms (D-95): a runner's copy of their data never waits on their
 * accepting new terms.
 */
export const requestExportFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => exportRequestInput.parse(data))
  .handler(async ({ data }) =>
    requestExport(
      db(),
      {
        userId: await requireUserIdBeforeTerms(),
        idempotencyKey: data.idempotencyKey,
      },
      { queue: env.EXPORTS_QUEUE, report: captureException },
      nowSeconds(),
    ),
  );

/**
 * ACC-9's Delete my account: proved by the current password, or by a
 * fresh Google sign-in for an account with none.
 */
export const requestDeletionFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => accountDeletionInput.parse(data))
  .handler(async ({ data }) =>
    requestAccountDeletion(
      db(),
      {
        ...(await requireSignedInSince()),
        currentPassword: data.currentPassword,
        checkPassword: checkCurrentPassword,
      },
      deletionEffectsFromEnv(),
    ),
  );

/**
 * "Keep your account?" · Keep my account (ACC-9): the one server function
 * a runner inside their deletion's week may call.
 */
export const keepAccountFn = createServerFn({ method: "POST" }).handler(
  async () => keepAccount(db(), await requireUserIdWhileLeaving()),
);

/**
 * What `/account/leaving` shows this visitor: a signed-in runner's
 * pending deletion, or the date a request just answered.
 */
export const leavingQuery = createServerFn({ method: "GET" })
  .validator((data: unknown) => leavingSearch.parse(data))
  .handler(async ({ data }) =>
    leavingView(db(), await optionalUserId(), data.on),
  );

/**
 * What `/account/terms` shows this visitor (ACC-6): the prompt, for a
 * signed-in runner behind on the terms.
 */
const termsPromptQuery = createServerFn({ method: "GET" }).handler(
  async () => termsPromptView(db(), await optionalUserId()),
);

/**
 * The terms prompt's Accept (ACC-6): the one write a runner behind on the
 * terms may make, so it is gated by everything but the terms.
 */
export const acceptTermsFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => acceptTermsInput.parse(data))
  .handler(async ({ data }) =>
    acceptTerms(db(), await requireUserIdBeforeTerms(), data.version),
  );

/**
 * `/privacy`, `/terms` and `/copyright`'s loader (ACC-13): the page's
 * text, or X1 while it is unpublished, and the bell's count.
 */
export async function legalPageLoader(slug: LegalSlug) {
  const page = await legalPageQuery({ data: { slug } });
  return { doc: legalDocOrNotFound(page.doc), unreadCount: page.unreadCount };
}

/**
 * `/account/terms`' loader (ACC-6): the prompt's view, or home for anyone
 * with nothing to accept.
 */
export async function termsPromptLoader() {
  const view = await termsPromptQuery();
  homeIfNothingToSay(view);
  return view;
}
