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
  banEmail,
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
  removalSentence,
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
  QUARANTINE_PAGE,
  QUARANTINE_RETENTION_SECONDS,
  quarantinedContentFor,
  quarantineInsert,
  type QuarantineRecord,
} from "./quarantine";

export {
  moderationActionInsert,
  wasModerated,
  type ModerationAction,
  type ModerationRecord,
} from "./moderation-actions";

export {
  deskRunners,
  runnersWhere,
  type DeskRunner,
  type ListedAccount,
  type RunnerState,
  type RunnersFilter,
} from "./runners";

export {
  placeholderHandle,
  renameRecord,
  type RenameOutcome,
  type RenameRecordInput,
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
  openSubject,
  pendingReviewCount,
  pendingReviewQueue,
  reasonsFrom,
  releaseStaleClaims,
  resolveReview,
  settleOpenReviews,
  type ClaimOutcome,
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
  runnerNotLeaving,
} from "./visibility";

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
export {
  ContentRemoved,
  NoticeBand,
  PhotoBeingChecked,
} from "./components/NoticeBand";
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
  type ReviewActionValues,
} from "./inputs";

export {
  clustersIn,
  duplicateProducts,
  type DuplicateCandidate,
} from "./duplicates";
