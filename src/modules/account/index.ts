/**
 * The account module's public API (task 126): the handle today; email,
 * verification, invites, export and deletion as they land.
 *
 * Server-fn glue lives in ./functions, imported directly by route files,
 * so this barrel stays importable in the vitest workers pool.
 */
export { forceRename, lookUpHandle } from "./handles";
export { reviewFlaggedHandle } from "./handles";
export { accountCount, listAccounts } from "./access";
export {
  changeLinkWithdrawal,
  emailConfirmationRead,
  isUnconfirmed,
} from "./verification";
export { accessGate } from "./access";
export { receiveAccessRequest } from "./access";
export {
  currentTermsVersion,
  latestAcceptanceOf,
  termsStandingOf,
} from "./terms";
export { authMail } from "./verification";
export type { AuthMail } from "./verification";
