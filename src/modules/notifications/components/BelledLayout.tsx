import type { JSX, ReactNode } from "react";

import { Layout } from "../../../ui";
import { NotificationBell } from "./NotificationBell";

/**
 * `Layout` with the bell already in its slot.
 *
 * Seven authenticated routes each loaded an unread count and wrote
 * `<Layout bell={<NotificationBell unreadCount={unreadCount} />}>` — the
 * same two imports and the same wiring, seven times. The count still comes
 * from the route's own loader, because that is a server call and a
 * component may not make one (CLAUDE.md); what moves here is only the
 * wiring.
 *
 * It lives in `modules/notifications` rather than in `ui/` for the reason
 * `Layout` takes `bell` as a prop at all: `ui/` is foundation and may not
 * import from `modules/`, and the bell is a notifications concern.
 */
export function BelledLayout({
  unreadCount,
  children,
}: Readonly<{ unreadCount: number; children: ReactNode }>): JSX.Element {
  return (
    <Layout bell={<NotificationBell unreadCount={unreadCount} />}>
      {children}
    </Layout>
  );
}
