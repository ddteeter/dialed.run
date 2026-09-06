import { Link } from "@tanstack/react-router";

import { Bracketed } from "../../../ui";

/**
Minimal MVP bell (102 §7): unread count only, no live updates — the count
is as fresh as the page's own load (server-first per CLAUDE.md). Mounted
into ui/Layout's notification-bell slot.
*/
export function NotificationBell({
  unreadCount,
}: Readonly<{ unreadCount: number }>) {
  return (
    <Link
      to="/runs/notifications"
      aria-label="Notifications"
      className="flex items-center gap-1 no-underline"
    >
      <span aria-hidden="true">🔔</span>
      {unreadCount > 0 && <Bracketed className="text-xs">{unreadCount}</Bracketed>}
    </Link>
  );
}
