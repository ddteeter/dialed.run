import type { JSX } from "react";

import type { BellState } from "../bell-state";
import { NotificationBell } from "./NotificationBell";

/**
 * The bell for a page the router draws itself — the signed-in 404 and the
 * loader-failed band (PR #104, owner 2026-11-06) — drawn from a read the
 * caller hands in.
 *
 * `router.tsx` passes `bellStateFn`, because a component may not import a
 * server function, and the system states call the result after mount.
 * Here rather than in the router so the one step it takes — counts in,
 * the bell out — is something a test can reach.
 */
export function bellLoader(
  read: () => Promise<BellState>,
): () => Promise<JSX.Element> {
  return async () => {
    const { unreadCount, verdictsWaiting } = await read();
    return (
      <NotificationBell
        unreadCount={unreadCount}
        verdictsWaiting={verdictsWaiting}
      />
    );
  };
}
