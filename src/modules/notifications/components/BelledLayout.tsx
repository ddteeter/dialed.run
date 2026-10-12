import type { JSX, ReactNode } from "react";

import { Layout } from "../../../ui";
import type { BellState } from "../bell-state";
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
 * Round 22 gave the bell a number as well as a dot, so every route loads
 * `bellStateFn` and spreads it here. Both counts are required (FEED-3): a
 * route that passed only its unread count drew a dot where the number
 * belonged, and now does not compile.
 *
 * It lives in `modules/notifications` rather than in `ui/` for the reason
 * `Layout` takes `bell` as a prop at all: `ui/` is foundation and may not
 * import from `modules/`, and the bell is a notifications concern.
 */
export function BelledLayout({
  unreadCount,
  verdictsWaiting,
  children,
}: Readonly<BellState & { children: ReactNode }>): JSX.Element {
  return (
    <Layout
      bell={
        <NotificationBell
          unreadCount={unreadCount}
          verdictsWaiting={verdictsWaiting}
        />
      }
    >
      {children}
    </Layout>
  );
}
