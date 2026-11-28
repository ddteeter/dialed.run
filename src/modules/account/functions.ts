/**
 * Server-fn glue for the account module (imported directly by route files,
 * per modules/auth's pattern) — keeps this module's other files loadable
 * in the vitest workers pool with no TanStack virtual entries.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { coreDb, env, primaryCoreDb, waitUntil } from "../../env";
import { accountDeletionInput, usernameInput } from "../../lib/contracts";
import {
  blockedRegionOf,
  isFromBlockedRegion,
} from "../../lib/contracts/access";
import {
  checkCurrentPassword,
  currentSessionId,
  deploymentPosture,
  optionalUserId,
  requireSignedInSince,
  requireUserId,
  requireUserIdBeforeTerms,
  requireUserIdWhileLeaving,
  verifiedUserId,
} from "../auth";
import { nowSeconds } from "../../lib/now";
import { noInput } from "../../lib/no-input";
import { TURNSTILE_ACTIONS } from "../../lib/turnstile-actions";
import { emailDepsFromEnv } from "../email";
import { turnstileSiteKey, verifyTurnstileToken } from "../ops/edge";
import { purgePublicPagesFor } from "../ops/public-web";
import { captureException } from "../ops/sentry";
import { turnstileAttempt } from "../ops/edge";
import { settleOwedEmail } from "../ops/owed-email";
import { requireAdmin } from "../safety/rules";
import { confirmAccessAsk, requestAccess } from "./access/access";
import { accountPage, accountView, ownAddressView } from "./data/account-view";
import { requestExport } from "./data/data-exports";
import {
  deletionEffectsFromEnv,
  keepAccount,
  leavingView,
  requestAccountDeletion,
} from "./data/deletion";
import { confirmDeletionLink, readDeletionLanding } from "./data/deletion-link";
import {
  acceptTermsInput,
  accessConfirmInput,
  changeEmailInput,
  confirmInput,
  deskRowInput,
  exportRequestInput,
  legalPageInput,
  newInviteInput,
  requestAccessInput,
  resendInput,
  themeInput,
} from "./inputs";
import {
  accessDesk,
  createInviteCode,
  declineRequest,
  inviteFromRequest,
  restoreInviteCode,
  revokeInviteCode,
} from "./access/invites";
import { handleScreenFromEnv } from "./handles/handle-screen";
import type { LegalSlug } from "./inputs";
import { legalPage, readerBellState } from "./terms/legal";
import { openSourcePage } from "./terms/open-source";
import {
  deskAccessSearch,
  homeIfNothingToSay,
  legalDocOrNotFound,
  leavingSearch,
} from "./route-decisions";
import { acceptTerms, termsPromptView } from "./terms/terms-acceptance";
import { ownTheme, setOwnTheme } from "./theme";
import {
  claimUsername,
  handleGate,
  keepPlaceholder,
  renameNoticeOf,
  usernameOf,
} from "./handles/username";
import {
  confirmEmail,
  readEmailLanding,
  requestEmailChange,
  resendConfirmation,
} from "./verification/verification";

function db() {
  return coreDb();
}

/**
 * O0 and Settings › Username: claim a handle, or hear it is taken and what
 * is free instead.
 */
export const claimUsernameFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => usernameInput.parse(data))
  .handler(async ({ data }) => {
    const userId = await requireUserId();
    return claimUsername(
      db(),
      userId,
      data.username,
      handleScreenFromEnv(captureException),
      purgePublicPagesFor(userId),
    );
  });

/**
 * The signed-in runner's handle, or nothing before O0 — for the settings
 * row and Settings › Username.
 */
export const usernameQuery = createServerFn({ method: "GET" }).handler(
  async () => ({ username: await usernameOf(db(), await requireUserId()) }),
);

/**
 * O0's "USERNAME CHANGED BY A MODERATOR" (ACC-12; round 27 #16): what
 * was taken, what stands in for it, and why — or nothing, which is O0.
 */
export const renameNoticeQuery = createServerFn({ method: "GET" }).handler(
  async () => ({ notice: await renameNoticeOf(db(), await requireUserId()) }),
);

/**
 * "Keep @runner_4821 for now": the re-pick is no longer owed.
 */
export const keepPlaceholderFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => noInput.parse(data))
  .handler(async () => {
    await keepPlaceholder(db(), await requireUserId());
  });

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
 * The signed-in runner's address and whether it is confirmed, for the
 * screens that wait on it (seam 7): the nag band on Feed and You, and the
 * address the confirm sheet names on Feed, D and H. One read of the
 * `user` row — none of them asks whether there is a password.
 */
export const ownAccountQuery = createServerFn({ method: "GET" }).handler(
  async () => ownAddressView(db(), await requireUserId()),
);

/**
 * Au4's Resend link (round 26 #11). No session needed: the page answers
 * the same for any address, and the limits are per visitor and per address.
 */
export const resendConfirmationFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => resendInput.parse(data))
  .handler(async ({ data }) =>
    resendConfirmation(
      db(),
      {
        email: data.email,
        visitor: {
          ip: turnstileAttempt(undefined, getRequest(), undefined).remoteIp,
          isLimited: deploymentPosture(env.BETTER_AUTH_URL).rateLimited,
        },
      },
      emailDepsFromEnv(),
      { keepAlive: waitUntil, report: captureException },
    ),
  );

/**
 * The confirm link's landing, as it opens: what the link would do, or why
 * it can't. GET, and it claims nothing (D-64: opening a link changes
 * nothing); the landing's loader calls it.
 */
export const readEmailLinkFn = createServerFn({ method: "GET" })
  .validator((data: unknown) => confirmInput.parse(data))
  .handler(async ({ data }) => readEmailLanding(db(), data.token));

/**
 * The Desk's deletion link's page, as it opens (round 64 #374.3): what
 * the link would do, or why it can't. GET, and it claims nothing (D-64).
 * No session: a closed account can't sign in, and the token is the
 * authority.
 */
export const readDeletionLinkFn = createServerFn({ method: "GET" })
  .validator((data: unknown) => confirmInput.parse(data))
  .handler(async ({ data }) => readDeletionLanding(db(), data.token));

/**
 * "Delete my account" on that page: spend the link and schedule the
 * purge a week on. POST because it changes state; on the primary, whose
 * reads authorise the write. No session, as above.
 */
export const confirmDeletionLinkFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => confirmInput.parse(data))
  .handler(async ({ data }) =>
    confirmDeletionLink(primaryCoreDb(), data.token, deletionEffectsFromEnv()),
  );

/**
 * The landing's one button: spend the link, and say which landing to
 * show. POST because it changes state.
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
        // Trusts the address, so it waits for a confirmed one (D-113).
        userId: await verifiedUserId(),
        newEmail: data.email,
        currentPassword: data.currentPassword,
        checkPassword: checkCurrentPassword,
      },
      emailDepsFromEnv(),
      {
        keepAlive: waitUntil,
        report: captureException,
        settle: settleOwedEmail,
      },
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
 * Whether Au2's request is placed in a state sign-up is closed in (round
 * 39 #69): read on load through the one gate, so the page says so before
 * the form. The server's refusal still decides at submit.
 */
export const signUpPlaceQuery = createServerFn({ method: "GET" }).handler(
  () => ({ isFromBlockedRegion: isFromBlockedRegion(getRequest()) }),
);

/**
 * Au5 · Request access (ACC-5). No session: the visitor has no account.
 * The limit applies where Better Auth's does — a real, https deployment.
 */
export const requestAccessFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => requestAccessInput.parse(data))
  .handler(async ({ data }) =>
    // Primary: its abuse limits gate the write (D-123, design 143).
    requestAccess(
      primaryCoreDb(),
      {
        email: data.email,
        note: data.note,
        attempt: turnstileAttempt(
          data.turnstileToken,
          getRequest(),
          TURNSTILE_ACTIONS.requestAccess,
        ),
        isLimited: deploymentPosture(env.BETTER_AUTH_URL).rateLimited,
        blockedRegion: blockedRegionOf(getRequest()),
      },
      verifyTurnstileToken,
      {
        deps: emailDepsFromEnv(),
        background: { keepAlive: waitUntil, report: captureException },
      },
    ),
  );

/**
 * An access request's confirm link (owner, 2026-11-21): no session, as
 * the ask had none; the token is the proof, and only its hash is stored.
 * Primary: the address's limit gates the write.
 */
export const confirmAccessFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => accessConfirmInput.parse(data))
  .handler(async ({ data }) =>
    confirmAccessAsk(primaryCoreDb(), {
      token: data.token,
      isLimited: deploymentPosture(env.BETTER_AUTH_URL).rateLimited,
    }),
  );

/**
Desk D7 · Access: requests and codes, for an operator only.
*/
export const accessDeskQuery = createServerFn({ method: "GET" })
  .validator((data: unknown) => deskAccessSearch.parse(data ?? {}))
  .handler(async ({ data }) => {
    requireAdmin(await verifiedUserId());
    return accessDesk(db(), data.after);
  });

/**
D7's New code.
*/
export const createInviteCodeFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => newInviteInput.parse(data))
  .handler(async ({ data }) =>
    createInviteCode(db(), {
      operatorId: requireAdmin(await verifiedUserId()),
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
        operatorId: requireAdmin(await verifiedUserId()),
        requestId: data.id,
      },
      {
        keepAlive: waitUntil,
        report: captureException,
        settle: settleOwedEmail,
      },
    ),
  );

/**
D7's Decline, on a request.
*/
export const declineRequestFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => deskRowInput.parse(data))
  .handler(async ({ data }) => {
    requireAdmin(await verifiedUserId());
    await declineRequest(db(), data.id);
  });

/**
D7's Revoke, on a code.
*/
export const revokeInviteCodeFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => deskRowInput.parse(data))
  .handler(async ({ data }) => {
    requireAdmin(await verifiedUserId());
    await revokeInviteCode(db(), data.id);
  });

/**
 * A legal page (ACC-13): its text if it is finished, and the bell for a
 * signed-in reader. No session needed — the policy is for anyone.
 */
const legalPageQuery = createServerFn({ method: "GET" })
  .validator((data: unknown) => legalPageInput.parse(data))
  .handler(async ({ data }) =>
    legalPage(db(), data.slug, await optionalUserId()),
  );

/**
 * `/open-source` (plan C9): the licence groups, the third-party notices,
 * and the bell for a signed-in reader. No session needed, as for the
 * legal texts.
 */
const openSourcePageQuery = createServerFn({ method: "GET" }).handler(
  async () => openSourcePage(db(), await optionalUserId()),
);

/**
Revoke's undo.
*/
export const restoreInviteCodeFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => deskRowInput.parse(data))
  .handler(async ({ data }) => {
    requireAdmin(await verifiedUserId());
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
export const keepAccountFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => noInput.parse(data))
  .handler(async () => keepAccount(db(), await requireUserIdWhileLeaving()));

/**
 * What `/account/leaving` shows this visitor: a signed-in runner's
 * pending deletion, or the date a request just answered.
 */
export const leavingQuery = createServerFn({ method: "GET" })
  .validator((data: unknown) => leavingSearch.parse(data))
  .handler(async ({ data }) => leavingView(db(), await optionalUserId(), data));

/**
 * What `/account/terms` shows this visitor (ACC-6): the prompt, for a
 * signed-in runner behind on the terms.
 */
const termsPromptQuery = createServerFn({ method: "GET" }).handler(async () =>
  termsPromptView(db(), await optionalUserId()),
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
 * `/how-it-works` (#523): a page of fixed words, so all it reads is the
 * bell for a signed-in reader. No session needed, as for the legal texts.
 */
const howItWorksPageQuery = createServerFn({ method: "GET" }).handler(
  async () => ({
    bellState: await readerBellState(db(), await optionalUserId()),
  }),
);

/**
`/how-it-works`' loader.
*/
export async function howItWorksPageLoader() {
  return howItWorksPageQuery();
}

/**
`/open-source`'s loader.
*/
export async function openSourcePageLoader() {
  return openSourcePageQuery();
}

/**
 * `/privacy`, `/terms` and `/copyright`'s loader (ACC-13): the page's
 * text, or X1 while it is unpublished, and the bell.
 */
export async function legalPageLoader(slug: LegalSlug) {
  const page = await legalPageQuery({ data: { slug } });
  return { doc: legalDocOrNotFound(page.doc), bellState: page.bellState };
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

/**
 * The theme for the root's answer (design 185): the runner's, or the
 * system for nobody (R48·133, "signed out: always system"). Not gated on
 * the terms or on leaving, because the root asks it for every page such a
 * runner can still reach, and how the page looks refuses nobody.
 */
export const ownThemeQuery = createServerFn({ method: "GET" }).handler(
  async () => ownTheme(db(), await optionalUserId()),
);

/**
 * U1 › Display › Theme, saved at once (R48·133). Unconfirmed runners too:
 * it is how their own screen looks, and nobody else sees it.
 */
export const setThemeFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => themeInput.parse(data))
  .handler(async ({ data }) =>
    setOwnTheme(db(), await requireUserId(), data.theme),
  );
