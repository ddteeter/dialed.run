/**
 * The safety module's public API (task 106).
 *
 * Framework-free on purpose: nothing here pulls `@tanstack/react-start`, so
 * this barrel stays importable from the vitest workers pool. Server-fn glue
 * lives in ./functions and is imported directly by route files, the same
 * split `modules/auth` documents.
 */

export {
  AdminRequiredError,
  isAdmin,
  isAdminRequired,
  requireAdmin,
} from "./admin";

export {
  banStateOf,
  bannedAmong,
  banUser,
  unbanUser,
  type BanInput,
  type BanState,
} from "./bans";

export {
  blockRunner,
  blockedAmong,
  blockedRunners,
  hiddenCounterpartIds,
  isBlocked,
  SelfBlockError,
  unblockRunner,
  type BlockedRunner,
} from "./blocks";

export {
  autoHideReporterThreshold,
  reportReasonSchema,
  reportReasons,
  reportSubjectTypeSchema,
  reportSubjectTypes,
  underReviewLabel,
  type ReportReason,
  type ReportSubjectType,
} from "./contracts";

export { denyDomain, domainOf, isDeniedDomain } from "./denylist";

export {
  distinctReporterCount,
  fileReport,
  isQueuedForReview,
  reportedSubjectIdsFor,
  type FileReportInput,
  type FileReportResult,
} from "./reports";

export {
  claimForReview,
  pendingReviewCount,
  pendingReviewQueue,
  resolveReview,
  type ClaimOutcome,
  type QueueRow,
  type ResolveOutcome,
  type ReviewDecision,
} from "./review";

export {
  isEntryPubliclyVisible,
  isOwnEntry,
  publiclyVisibleEntry,
} from "./visibility";
