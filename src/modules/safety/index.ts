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
  reportReasonLabels,
  reportReasonSchema,
  reportReasons,
  reportSubjectTypeSchema,
  reportSubjectTypes,
  underReviewLabel,
  type ReportReason,
  type ReportSubjectType,
} from "./contracts";

export { denyDomain, isDeniedDomain } from "./denylist";

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

export { classifierFromEnv } from "./classifier/from-env";

export {
  decide,
  imageCategories,
  MODERATION_MODEL,
  thresholds,
  type CategoryScores,
  type ImageCategory,
  type ModerationResult,
} from "./classifier/moderation";

export {
  pendingEntryPhotos,
  pendingGarmentPhotos,
  screenPhoto,
  type Classify,
  type PendingPhoto,
  type PhotoScope,
  type PhotoToScreen,
  type ScreenOutcome,
} from "./screening";

export { retryPendingScreenings, type RetryReport } from "./retry";

export { BlockedRunners } from "./components/BlockedRunners";
export { ReportAffordance } from "./components/ReportAffordance";
export { ReportSheet, type ReportSubject } from "./components/ReportSheet";
export { ReviewQueue } from "./components/ReviewQueue";

export {
  banUserInput,
  blockRunnerInput,
  denyDomainInput,
  fileReportInput,
  reviewDecisionInput,
  type FileReportValues,
} from "./inputs";

export {
  clustersIn,
  duplicateProducts,
  type DuplicateCandidate,
} from "./duplicates";
