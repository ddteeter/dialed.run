/**
 * The counters in `rate_limits` (design 261, B12): every limit the app
 * keeps — sends per address, a visitor's form posts, a runner's changes,
 * sign-in tries, enrichment's spend. A floor unit, so any module may
 * import it; it imports no feature module.
 */
export {
  claimEmailSend,
  claimLimit,
  claimRunnerChange,
  claimSignInTry,
  countLimit,
  countSend,
  forgetRateLimit,
  forgetSendLimits,
  forgetSignInTries,
  isWithinRateLimit,
  limitAllowed,
  limitClaimOf,
  sendClaimOf,
  sweepRateLimits,
  type SendClaim,
} from "./rate-limit";
