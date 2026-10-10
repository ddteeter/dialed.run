import { describe, expect, it } from "vitest";

import {
  isInstrumented,
  repoPath,
  serverFunctionsIn,
  withoutComments,
} from "./source-text";

/**
 * Which server functions and server routes wait for a confirmed address
 * (design 133, decision D-113), held against the code both ways.
 *
 * **The rule:** writes that others can see, or that trust the address,
 * require a confirmed email — through the one gate, `auth`'s
 * `verifiedUserId`. Whether a function is one of those is a product
 * decision, so it is made here, one reviewable row per function, rather
 * than by whichever gate its author happened to reach for.
 *
 * **Default-deny.** A server function or route handler with no row here
 * fails, so a new one is refused until someone decides its class. A row
 * with no function fails, and so does a row whose class the body does not
 * match. The classes, read from the body's text:
 *
 * - `verified`: calls `verifiedUserId`.
 * - `admin`: `requireAdmin(await verifiedUserId())` — the Desk (Q5).
 * - `verified-viewer`: calls `optionalVerifiedUserId`, the same gate
 *   asked so that a refusal reads as nobody — for a door that answers
 *   "no" as not-found: the Desk's, and a reviewer's photo (Q5).
 * - `unconfirmed`: calls one of the signed-in gates that do not ask the
 *   address (`requireUserId` and the terms gate's named exemptions), and
 *   not `verifiedUserId`.
 * - `sessionless`: none of them — `optionalUserId`, a signed link or a
 *   token, or nothing at all.
 *
 * An admin function on a gate that does not ask the address reads as
 * `admin-unconfirmed`, which is not a class anything may have.
 *
 * Read as text, as `terms-exempt` does: neither a `functions.ts` nor a
 * route can be imported by a test.
 */
const functionSources: Record<string, string> = import.meta.glob(
  "../../src/modules/*/functions.ts",
  { query: "?raw", import: "default", eager: true },
);

const routeSources: Record<string, string> = import.meta.glob(
  "../../src/routes/**/*.{ts,tsx}",
  { query: "?raw", import: "default", eager: true },
);

type VerificationClass =
  "verified" | "admin" | "verified-viewer" | "unconfirmed" | "sessionless";

const SIGNED_IN_GATES =
  /\b(?:requireUserId|requireUserIdBeforeTerms|requireSignedInSince|requireUserIdWhileLeaving|checkCurrentPassword)\b/u;

/**
 * The class a body's text says it is. A route handler's session read
 * (`sessionFromRequest`) counts as signed-in unless it is only an optional
 * one (`optionalUserIdFrom`).
 */
function classOf(body: string): string {
  const isVerified = /\bverifiedUserId\b/u.test(body);
  if (/\brequireAdmin\(/u.test(body)) {
    return isVerified ? "admin" : "admin-unconfirmed";
  }
  if (isVerified) return "verified";
  if (/\boptionalVerifiedUserId\(/u.test(body)) return "verified-viewer";
  const hasSessionRead =
    /\bsessionFromRequest\(/u.test(body) &&
    !/\boptionalUserIdFrom\(/u.test(body);
  return hasSessionRead || SIGNED_IN_GATES.test(body)
    ? "unconfirmed"
    : "sessionless";
}

const HANDLER_START = /^(?=[ \t]+(?:GET|POST|PUT|PATCH|DELETE):)/mu;
const HANDLER_METHOD = /^[ \t]+(GET|POST|PUT|PATCH|DELETE):/u;

/**
 * Each `server.handlers` entry in a route file, by file and method
 * (`routes/api/auth/$.ts POST`), with its own text up to the next one.
 */
function routeHandlers(): { name: string; body: string }[] {
  return Object.entries(routeSources)
    .filter(
      ([path, source]) =>
        !isInstrumented(source) &&
        !path.endsWith("routeTree.gen.ts") &&
        source.includes("handlers:"),
    )
    .flatMap(([path, source]) => {
      const file = repoPath(path).replace("src/", "");
      const code = withoutComments(source);
      const handlers = code.slice(code.indexOf("handlers:"));
      return handlers.split(HANDLER_START).flatMap((body) => {
        const method = HANDLER_METHOD.exec(body)?.[1];
        return method === undefined
          ? []
          : [{ name: `${file} ${method}`, body }];
      });
    });
}

/**
 * Every server function and route handler, and the class the owner's
 * answers give it (D-113). One row each: adding a function means adding
 * its row, and choosing.
 */
const CLASSES: Readonly<Record<string, VerificationClass>> = {
  // ---- account
  // Q2: a handle can be claimed unconfirmed; the runner is not findable
  // until confirmed (feed's runner-visibility floor).
  "account/functions.ts claimUsernameFn": "unconfirmed",
  "account/functions.ts usernameQuery": "unconfirmed",
  "account/functions.ts renameNoticeQuery": "unconfirmed",
  "account/functions.ts keepPlaceholderFn": "unconfirmed",
  "account/functions.ts handleGateQuery": "sessionless",
  "account/functions.ts accountPageQuery": "unconfirmed",
  "account/functions.ts optionalAccountQuery": "sessionless",
  "account/functions.ts ownAccountQuery": "unconfirmed",
  "account/functions.ts resendConfirmationFn": "sessionless",
  "account/functions.ts confirmEmailFn": "sessionless",
  // Q8: trusts the address.
  "account/functions.ts requestEmailChangeFn": "verified",
  "account/functions.ts turnstileSiteKeyQuery": "sessionless",
  "account/functions.ts requestAccessFn": "sessionless",
  "account/functions.ts accessDeskQuery": "admin",
  "account/functions.ts createInviteCodeFn": "admin",
  "account/functions.ts inviteFromRequestFn": "admin",
  "account/functions.ts declineRequestFn": "admin",
  "account/functions.ts revokeInviteCodeFn": "admin",
  "account/functions.ts legalPageQuery": "sessionless",
  "account/functions.ts restoreInviteCodeFn": "admin",
  // Q6 (D-95): portability and leaving never wait.
  "account/functions.ts requestExportFn": "unconfirmed",
  "account/functions.ts requestDeletionFn": "unconfirmed",
  "account/functions.ts keepAccountFn": "unconfirmed",
  "account/functions.ts leavingQuery": "sessionless",
  "account/functions.ts termsPromptQuery": "sessionless",
  "account/functions.ts acceptTermsFn": "unconfirmed",
  // ---- auth
  "auth/functions.ts getSession": "sessionless",
  "auth/functions.ts signedInQuery": "sessionless",
  // ---- closet
  "closet/functions.ts listItemsFn": "unconfirmed",
  "closet/functions.ts closetNearbyFn": "unconfirmed",
  "closet/functions.ts getItemFn": "unconfirmed",
  // Q1: unconfirmed, with closet's clamp — no shared brand or product
  // until the address is confirmed.
  "closet/functions.ts createItemFn": "unconfirmed",
  "closet/functions.ts updateItemFn": "unconfirmed",
  "closet/functions.ts retireItemFn": "unconfirmed",
  "closet/functions.ts unretireItemFn": "unconfirmed",
  "closet/functions.ts deleteItemFn": "unconfirmed",
  "closet/functions.ts addFromTapListFn": "unconfirmed",
  "closet/functions.ts uploadPhotoFn": "unconfirmed",
  "closet/functions.ts removePhotoFn": "unconfirmed",
  // ---- email
  "email/functions.ts unsubscribeLinkQuery": "sessionless",
  "email/functions.ts unsubscribeFn": "sessionless",
  "email/functions.ts resubscribeFn": "sessionless",
  "email/functions.ts notificationSettingsQuery": "unconfirmed",
  "email/functions.ts saveNotificationSettingsFn": "unconfirmed",
  // ---- feed
  // Q4: entries, verdicts, captions and photos, with D-50's clamp keeping
  // an unconfirmed runner's entries private.
  "feed/functions.ts attachKitAction": "unconfirmed",
  "feed/functions.ts attachContextQuery": "unconfirmed",
  "feed/functions.ts prefillForRunQuery": "unconfirmed",
  "feed/functions.ts submitVerdictAction": "unconfirmed",
  "feed/functions.ts verdictBacklogQuery": "unconfirmed",
  "feed/functions.ts unjudgedRunCountQuery": "unconfirmed",
  "feed/functions.ts saveBacklogRowAction": "unconfirmed",
  "feed/functions.ts verdictBandCountsQuery": "unconfirmed",
  "feed/functions.ts bandSignalsQuery": "unconfirmed",
  "feed/functions.ts itemBandWearStatQuery": "unconfirmed",
  "feed/functions.ts verdictPromptQuery": "unconfirmed",
  "feed/functions.ts recordVerdictPromptedAction": "unconfirmed",
  "feed/functions.ts entryDetailQuery": "unconfirmed",
  // A count and a notification another runner sees.
  "feed/functions.ts setUsefulAction": "verified",
  // Q3: a follower count others see; unfollow only removes.
  "feed/functions.ts followAction": "verified",
  "feed/functions.ts unfollowAction": "unconfirmed",
  "feed/functions.ts followStatusQuery": "unconfirmed",
  "feed/functions.ts followingFeedQuery": "unconfirmed",
  "feed/functions.ts yourConditionsQuery": "unconfirmed",
  "feed/functions.ts conditionsHomeQuery": "unconfirmed",
  "feed/functions.ts saveConditionsCityAction": "unconfirmed",
  "feed/functions.ts viewerUnitsQuery": "sessionless",
  "feed/functions.ts ownProfileQuery": "unconfirmed",
  "feed/functions.ts runnerHandleQuery": "unconfirmed",
  "feed/functions.ts profileAtHandleQuery": "unconfirmed",
  "feed/functions.ts searchQuery": "unconfirmed",
  "feed/functions.ts uploadPhotoAction": "unconfirmed",
  "feed/functions.ts retractEntryAction": "unconfirmed",
  "feed/functions.ts deleteEntryPhotoAction": "unconfirmed",
  "feed/functions.ts garmentBandCountQuery": "unconfirmed",
  "feed/functions.ts decideReviewAction": "admin",
  "feed/functions.ts takedownAction": "admin",
  // ---- notifications
  "notifications/functions.ts listNotificationsFn": "unconfirmed",
  "notifications/functions.ts unreadNotificationCountFn": "unconfirmed",
  "notifications/functions.ts markAllNotificationsReadFn": "unconfirmed",
  "notifications/functions.ts bellStateFn": "unconfirmed",
  // ---- onboarding
  "onboarding/functions.ts callLadderQuery": "unconfirmed",
  "onboarding/functions.ts localeUnitsQuery": "sessionless",
  "onboarding/functions.ts saveCalibrationFn": "unconfirmed",
  "onboarding/functions.ts starterListQuery": "unconfirmed",
  "onboarding/functions.ts completeOnboardingFn": "unconfirmed",
  "onboarding/functions.ts settingsQuery": "unconfirmed",
  "onboarding/functions.ts saveUnitsFn": "unconfirmed",
  "onboarding/functions.ts saveSharingFn": "unconfirmed",
  "onboarding/functions.ts lookUpCityFn": "unconfirmed",
  "onboarding/functions.ts onboardingGateQuery": "sessionless",
  "onboarding/functions.ts namingOfferQuery": "unconfirmed",
  // Q1: closet's clamp, as createItemFn.
  "onboarding/functions.ts nameGarmentFn": "unconfirmed",
  // F1 (D-58): other runners' names, signed-in only.
  "onboarding/functions.ts namingSuggestionsQuery": "unconfirmed",
  // ---- ops
  // Q5: the Desk's door asks what its functions ask, so an unconfirmed
  // operator is not shown a Desk that refuses them.
  "ops/functions.ts deskAccessQuery": "verified-viewer",
  "ops/functions.ts deskTodayQuery": "admin",
  "ops/functions.ts deskGaveUpQuery": "admin",
  "ops/functions.ts retryGaveUpAction": "admin",
  "ops/functions.ts dropGaveUpAction": "admin",
  // ---- products
  "products/functions.ts searchBrandsFn": "unconfirmed",
  // ---- runs (never shown to anyone)
  "runs/functions.ts submitManualRun": "unconfirmed",
  "runs/functions.ts startFileImport": "unconfirmed",
  "runs/functions.ts getImportOutcomeFn": "unconfirmed",
  "runs/functions.ts getRunSummaryFn": "unconfirmed",
  "runs/functions.ts listRunSummariesFn": "unconfirmed",
  "runs/functions.ts setRunConditionsFn": "unconfirmed",
  "runs/functions.ts retryRunWeatherFn": "unconfirmed",
  "runs/functions.ts retimeRunFn": "unconfirmed",
  "runs/functions.ts getStravaStatusFn": "unconfirmed",
  "runs/functions.ts completeStravaConnectFn": "unconfirmed",
  "runs/functions.ts disconnectStravaFn": "unconfirmed",
  "runs/functions.ts deleteRunFn": "unconfirmed",
  // ---- safety
  // Report trusts the address: the threshold counts accounts (SAF-15).
  "safety/functions.ts fileReportAction": "verified",
  // Q7: a safety tool works for anyone, and a block is silent.
  "safety/functions.ts blockRunnerAction": "unconfirmed",
  "safety/functions.ts unblockRunnerAction": "unconfirmed",
  "safety/functions.ts blockedRunnersQuery": "unconfirmed",
  "safety/functions.ts reviewQueueQuery": "admin",
  "safety/functions.ts claimReviewAction": "admin",
  "safety/functions.ts banUserAction": "admin",
  "safety/functions.ts denyDomainAction": "admin",
  "safety/functions.ts unbanUserAction": "admin",
  "safety/functions.ts reviewHandleAction": "admin",
  "safety/functions.ts forceRenameAction": "admin",
  "safety/functions.ts deskRunnersQuery": "admin",

  // ---- server routes
  // A signed link's token, or the viewer if any.
  "routes/account/export.$token.ts GET": "sessionless",
  // RFC 8058's one-click POST: a signed link.
  "routes/account/unsubscribe.tsx POST": "sessionless",
  // Better Auth's own endpoints, sign-up and sign-in among them.
  "routes/api/auth/$.ts GET": "sessionless",
  "routes/api/auth/$.ts POST": "sessionless",
  "routes/api/health.ts GET": "sessionless",
  // Strava's handshake and its webhook: a machine, verified by token.
  "routes/api/strava.ts GET": "sessionless",
  "routes/api/strava.ts POST": "sessionless",
  // The owner's own garment photo.
  "routes/closet/photo.$itemId.$size.ts GET": "unconfirmed",
  // Entry photos: visibility is decided per viewer, signed out included.
  "routes/feed/photo.$.tsx GET": "sessionless",
  "routes/og/default.ts GET": "sessionless",
  "routes/runs/strava-connect.ts GET": "sessionless",
  // A reviewer's view of a photo: a Desk read (Q5), asked of `isAdmin`
  // inside (`reviewerPhotoResponse`) for a confirmed viewer only.
  "routes/safety/review-photo.$.tsx GET": "verified-viewer",
};

function byName(left: string, right: string): number {
  return left.localeCompare(right);
}

describe("every server function and route has a verification class (D-113)", () => {
  const found = [...serverFunctionsIn(functionSources), ...routeHandlers()];

  it("finds the functions and routes it checks", () => {
    expect(found.length).toBeGreaterThan(100);
    expect(routeHandlers().length).toBeGreaterThan(10);
  });

  it("refuses any function or route nobody has classified", () => {
    const unclassified = found
      .map(({ name }) => name)
      .filter((name) => !Object.hasOwn(CLASSES, name));
    expect(unclassified).toStrictEqual([]);
  });

  it("names no function or route that is not there", () => {
    const names = new Set(found.map(({ name }) => name));
    const stale = Object.keys(CLASSES).filter((name) => !names.has(name));
    expect(stale).toStrictEqual([]);
  });

  it("holds each one to its class", () => {
    const actual = Object.fromEntries(
      found
        .map(({ name, body }) => [name, classOf(body)] as const)
        .toSorted(([left], [right]) => byName(left, right)),
    );
    const expected = Object.fromEntries(
      Object.entries(CLASSES).toSorted(([left], [right]) =>
        byName(left, right),
      ),
    );
    expect(actual).toStrictEqual(expected);
  });
});

describe("the classes, read from the text", () => {
  it.each([
    ["const id = await verifiedUserId();", "verified"],
    ["requireAdmin(await verifiedUserId());", "admin"],
    ["requireAdmin(await requireUserId());", "admin-unconfirmed"],
    ["const id = await requireUserId();", "unconfirmed"],
    ["await requireUserIdBeforeTerms();", "unconfirmed"],
    ["await requireSignedInSince();", "unconfirmed"],
    ["await requireUserIdWhileLeaving();", "unconfirmed"],
    ["await checkCurrentPassword(password);", "unconfirmed"],
    ["await sessionFromRequest(request);", "unconfirmed"],
    ["optionalUserIdFrom(await sessionFromRequest(request));", "sessionless"],
    ["await optionalUserId();", "sessionless"],
    ["isOperator(await optionalVerifiedUserId());", "verified-viewer"],
    ["return auth.handler(request);", "sessionless"],
  ])("reads %s as %s", (body, expected) => {
    expect(classOf(body)).toBe(expected);
  });
});
