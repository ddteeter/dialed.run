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
  reopenEmail,
  reopenEmailFor,
  banUser,
  unbanUser,
  type BanInput,
  type BanState,
  type Reopening,
} from "./bans";

export { banGate } from "./ban-gate";

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
  isCopyrightTakedown,
  removalNotice,
  removalReasons,
  removalReasonSchema,
  removalRuleOf,
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
  // The year-end purge (D-70), which rides the daily digest's firing.
  purgeExpiredQuarantine,
} from "./quarantine";

// D-131: the 3-year sweep, which rides the daily digest's firing too.
export { sweepModerationRecords } from "./retention";
export { keptFingerprints, removedMatchOf } from "./removed-fingerprints";

// D-130: a copyright takedown's 30-day hide, its restore and its purge.
export {
  claimDuePurges,
  claimPurgeAfterCase,
  copyrightHoldWrites,
  isCopyrightHeld,
  purgedWrite,
  restoreDueHolds,
  type CaseOverOutcome,
  type ClaimedPurge,
} from "./copyright-holds";

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

// C8 (D-132, D-145): the notices a report's life owes.
export { reporterNotices } from "./notices";

export {
  claimForReview,
  claimLeaseSeconds,
  enqueueForReview,
  openRow as openReviewRow,
  openSubject,
  pendingReviewCount,
  pendingReviewQueue,
  reasonsFrom,
  releaseStaleClaims,
  resolveReview,
  reviewResolution,
  settleOpenReviews,
  wasFlaggedAutomatically,
  type ClaimOutcome,
  type HandleReview,
  type HandleReviewOutcome,
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
  heldPhotoStatus,
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
export { RunRemovals } from "./components/RunRemovals";
export { removalsOnRun, type RunRemoval } from "./run-removals";

export {
  banUserInput,
  blockRunnerInput,
  copyrightHoldInput,
  denyDomainInput,
  fileReportInput,
  forceRenameInput,
  handleReviewInput,
  reviewActionInput,
  reviewDecisionInput,
  runnersFilterInput,
  takedownInput,
  removalDecisionInput,
  takedownRequestInput,
  blockRequesterInput,
  takedownConfirmInput,
  takedownConfirmSearch,
  unbanUserInput,
  type FileReportValues,
  type HandleReviewValues,
  type ReviewActionValues,
} from "./inputs";

export {
  clustersIn,
  duplicateProducts,
  type DuplicateCandidate,
} from "./duplicates";

export {
  blockAndDeclineAll,
  confirmTakedownRequest,
  fileTakedownRequest,
  pendingTakedownRequests,
  releaseHoldWrites,
  type PendingTakedownRequest,
  type TakedownRequestResult,
} from "./takedown-requests";

export {
  REMOVAL_REMINDER_LEAD_SECONDS,
  undecidedRemovalsDue,
} from "./removal-reminders";
