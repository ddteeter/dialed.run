/**
 * `account/verification`: confirming an address, changing it, and the mail
 * those send (design 240).
 */
export {
  changeLinkWithdrawal,
  claimFreshEmailLink,
  didClaimEmailLink,
  readEmailLink,
  releaseEmailLink,
  emailConfirmationRead,
  isUnconfirmed,
} from "./email-links";
export { authMail } from "./verification";
export type { ReadLink } from "./email-links";
export type {
  AuthMail,
  Background,
  OwedMail,
  PasswordCheck,
} from "./verification";
