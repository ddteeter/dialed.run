/**
 * Notifications — the module's public API.
 *
 * Lived inside modules/runs until the PR #4 review, because a run import
 * was the first thing that needed to tell a user something. That made the
 * `kind` union a runs concept by accident: it is already a general
 * notification system, and lane 104's follows and "someone found your kit
 * useful" are not runs. Left where it was, the next lane either imports
 * across into modules/runs or writes a second implementation.
 *
 * Moved before those kinds exist, which is the cheap moment to do it.
 */
export {
  createNotification,
  listNotifications,
  markAllNotificationsRead,
  unreadNotificationCount,
  type NotificationKind,
} from "./service";
