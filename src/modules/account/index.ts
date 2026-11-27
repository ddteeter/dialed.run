/**
 * The account module's public API (task 126): the handle today; email,
 * verification, invites, export and deletion as they land.
 *
 * Server-fn glue lives in ./functions, imported directly by route files,
 * so this barrel stays importable in the vitest workers pool.
 */
export {
  claimUsername,
  forceRename,
  lookUpHandle,
  usernameOf,
} from "./handles";
export { reviewFlaggedHandle } from "./handles";
export type {
  ForcedRename,
  ForceRenameRequest,
  HandleClaim,
  HandleLookup,
} from "./handles";
export {
  accountCount,
  ACCOUNTS_PAGE,
  listAccounts,
  prefixPattern,
} from "./access";
export type { AccountRow, AccountsQuery } from "./access";
export {
  changeLinkWithdrawal,
  emailConfirmationRead,
  isUnconfirmed,
  isVerified,
} from "./verification";
export { accessGate } from "./access";
export { receiveAccessRequest } from "./access";
export {
  currentTermsVersion,
  latestAcceptanceOf,
  termsStandingOf,
} from "./terms";
export {
  authMail,
  confirmEmail,
  readEmailLanding,
  requestEmailChange,
  resendConfirmation,
} from "./verification";
export type {
  AuthMail,
  ChangeResult,
  Landing,
  ResendAnswer,
} from "./verification";
