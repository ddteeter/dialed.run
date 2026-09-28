/**
 * The email module's public API (task 126, ACC-2) — the one sender, which
 * tasks 125, 127 and 128 call and never the binding
 * (docs/designs/126-accounts.md publishes it).
 *
 * Server-fn glue lives in ./functions, imported directly by route files,
 * so this barrel stays importable in the vitest workers pool.
 */
export { emailDebt } from "./debt";
export { deliverEmail, deliverOwedEmail, emailDepsFromEnv } from "./deliver";
export type { EmailDeps } from "./deliver";
export {
  emailPreferencesOf,
  setEmailPreference,
  isEmailWanted,
} from "./preferences";
export { claimEmailSend } from "./send-limit";
export type { LimitedSend, SendClaim } from "./send-limit";
export { notificationSettings } from "./settings";
export type { NotificationSettings } from "./settings";
