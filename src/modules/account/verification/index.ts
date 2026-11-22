/**
 * `account/verification`: confirming an address, changing it, and the mail
 * those send (design 240).
 */
export {
  changeLinkWithdrawal,
  emailConfirmationRead,
  runnerConfirmed,
  isUnconfirmed,
  isVerified,
} from "./email-links";
export {
  authMail,
  confirmEmail,
  readEmailLanding,
  requestEmailChange,
  resendConfirmation,
} from "./verification";
export type {
  AuthMail,
  Background,
  ChangeResult,
  Landing,
  OwedMail,
  PasswordCheck,
  ResendAnswer,
} from "./verification";
