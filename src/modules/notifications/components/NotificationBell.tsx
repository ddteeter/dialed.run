import { Link } from "@tanstack/react-router";

import { Bracketed, Icon } from "../../../ui";

/**
Minimal MVP bell (102 §7): unread count only, no live updates — the count
is as fresh as the page's own load (server-first per CLAUDE.md). Mounted
into ui/Layout's notification-bell slot.

The glyph is the pack's `bell`, not an emoji: an emoji renders in whatever
font the platform picks, which is the one thing an icon system exists to
stop. It also never animates — S2 in `design/Remaining Screens.dc.html` is
explicit that "the bell never rings, shakes or bounces. It changes state
and stops."

S2 also asks for a bare dot when there is something unread but nothing to
do, and a number only when that number is a to-do list. We only count
unread here, so the number is all we can honestly render; the dot state
arrives with the notification kinds that are not actionable.
*/
export function NotificationBell({
  unreadCount,
}: Readonly<{ unreadCount: number }>) {
  return (
    <Link
      to="/notifications"
      aria-label="Notifications"
      className="flex items-center gap-1 no-underline"
    >
      <Icon name="bell" size={20} />
      {unreadCount > 0 && (
        <Bracketed className="text-xs">{unreadCount}</Bracketed>
      )}
    </Link>
  );
}
