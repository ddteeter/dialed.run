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
  adminUserIds,
  isAdmin,
  isAdminRequired,
  requireAdmin,
} from "./admin";

export {
  banStateOf,
  banUser,
  unbanUser,
  type BanInput,
  type BanState,
} from "./bans";

export { ACCOUNT_CLOSED_CODE, banGate } from "./ban-gate";

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
  removalReasons,
  removalReasonSchema,
  removalStatements,
  renameReasons,
  renameReasonSchema,
  reportReasonLabels,
  reportReasonSchema,
  reportReasons,
  reportSubjectTypeSchema,
  reportSubjectTypes,
  type RemovalReason,
  type RenameReason,
  type ReportReason,
  type ReportSubjectType,
} from "./contracts";

export {
  moderationActionInsert,
  type ModerationAction,
  type ModerationRecord,
} from "./moderation-actions";

export {
  accountCount,
  deskRunners,
  prefixPattern,
  RUNNERS_PAGE,
  type DeskRunner,
  type RunnerState,
  type RunnersFilter,
} from "./runners";

export {
  forceRename,
  placeholderHandle,
  type ForceRenameInput,
  type RenameOutcome,
} from "./rename";

export { denyDomain, isDeniedDomain } from "./denylist";

export {
  distinctReporterCount,
  fileReport,
  isQueuedForReview,
  reconcileUnhiddenReports,
  reportedSubjectIdsFor,
  type FileReportInput,
  type FileReportResult,
  type ReconcileReport,
} from "./reports";

export {
  claimForReview,
  claimLeaseSeconds,
  openRow,
  pendingReviewCount,
  pendingReviewQueue,
  reasonsFrom,
  releaseStaleClaims,
  resolveReview,
  settleOpenReviews,
  type ClaimOutcome,
  type OpenRow,
  type QueueRow,
  type ReleaseReport,
  type ResolveOutcome,
  type ReviewDecision,
} from "./review";

export {
  entryVisibleTo,
  isUnderReviewForAuthor,
  notBlockedEitherWay,
  profileNotReportedBy,
  publicPhotoStatus,
  publiclyVisibleEntry,
} from "./visibility";

export {
  isSignatureValid,
  maxSignedLifeSeconds,
  signedBucketSeconds,
  signedExpiry,
  signPhotoKey,
  type PhotoSignature,
} from "./photo-signing";

export { classifierFromEnv } from "./classifier/from-env";

export {
  decide,
  imageCategories,
  MODERATION_MODEL,
  reviewFloors,
  thresholds,
  type CategoryScores,
  type ImageCategory,
  type ModerationResult,
  type ScreenDecision,
} from "./classifier/moderation";

export {
  pendingEntryPhotos,
  pendingGarmentFrom,
  pendingGarmentPhotos,
  screenPhoto,
  type Classify,
  type PendingPhoto,
  type PhotoScope,
  type PhotoToScreen,
  type ScreenOutcome,
} from "./screening";

export {
  contentTypeOf,
  retryPendingScreenings,
  type RetryReport,
} from "./retry";

export { AccountClosed } from "./components/AccountClosed";
export { BlockedRunners } from "./components/BlockedRunners";
export { ReportAffordance } from "./components/ReportAffordance";
export { ReportSheet, type ReportSubject } from "./components/ReportSheet";
export { ReviewQueue } from "./components/ReviewQueue";

export {
  banUserInput,
  blockRunnerInput,
  denyDomainInput,
  fileReportInput,
  forceRenameInput,
  reviewActionInput,
  reviewDecisionInput,
  runnersFilterInput,
  takedownInput,
  unbanUserInput,
  type FileReportValues,
} from "./inputs";

export {
  clustersIn,
  duplicateProducts,
  type DuplicateCandidate,
} from "./duplicates";
