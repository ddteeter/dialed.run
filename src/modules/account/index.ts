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
} from "./username";
export type {
  ForcedRename,
  ForceRenameRequest,
  HandleClaim,
  HandleLookup,
} from "./username";
export {
  accountCount,
  ACCOUNTS_PAGE,
  listAccounts,
  prefixPattern,
} from "./accounts";
export type { AccountRow, AccountsQuery } from "./accounts";
export { isUnconfirmed, isVerified } from "./email-links";
export { accessGate } from "./access";
export { termsStanding } from "./terms-acceptance";
export {
  authMail,
  confirmEmail,
  requestEmailChange,
  resendConfirmation,
} from "./verification";
export type {
  AuthMail,
  ChangeResult,
  Landing,
  ResendResult,
} from "./verification";
