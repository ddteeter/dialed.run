import { useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";

import type { FormFailure } from "../../../ui";
import {
  FormFailureBand,
  FormStatus,
  Mono,
  classifyFailure,
} from "../../../ui";
import type { listNotifications } from "../service";

type NotificationRow = Awaited<
  ReturnType<typeof listNotifications>
>[number];

/**
 * The server function, handed in rather than imported.
 *
 * `../functions` pulls TanStack Start's virtual server entry, and a file
 * that reaches it cannot be imported by any test — in either vitest
 * project, because the constraint is the import graph and not the runtime.
 * So the route wires it and this renders. The prop's shape is the server
 * function's own, so the route passes it with no wrapper.
 */
export interface NotificationListProps {
  notifications: readonly NotificationRow[];
  markAllRead: () => Promise<unknown>;
}

export function NotificationList({
  notifications,
  markAllRead,
}: Readonly<NotificationListProps>) {
  const navigate = useNavigate();
  const [isMarking, setIsMarking] = useState(false);
  const [failure, setFailure] = useState<FormFailure | undefined>();
  const [status, setStatus] = useState("");
  const inFlight = useRef(false);
  const retryRef = useRef<HTMLButtonElement>(null);

  /**
   * D-43: this was `try { … } finally { … }` with no `catch`, so a D1
   * failure re-threw out of a `void`-ed call. The button re-enabled, the
   * user was told nothing, and nothing reached Sentry (laws 5 and 7) — the
   * failure was an unhandled rejection and looked, on screen, exactly like
   * a click that had not registered.
   *
   * The register named the answer: the failure band the forms contract
   * already defines. `classifyFailure` is the same one a submit uses, so
   * this cannot drift into a second sentence for the same condition.
   */
  async function onMarkAllRead() {
    // The double-action guard lives here rather than on a `disabled`
    // attribute — §5, and the reason is the same one the contract gives:
    // a disabled button drops focus and stops announcing.
    if (inFlight.current) return;
    inFlight.current = true;
    setIsMarking(true);
    setFailure(undefined);
    try {
      await markAllRead();
      await navigate({ to: "/notifications" });
    } catch (error: unknown) {
      const classified = classifyFailure(error);
      setFailure(classified);
      setStatus(`Nothing saved. ${classified.message}`);
    } finally {
      setIsMarking(false);
      inFlight.current = false;
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <FormStatus>{status}</FormStatus>
      <button
        type="button"
        aria-disabled={isMarking || undefined}
        aria-busy={isMarking || undefined}
        onClick={() => {
          void onMarkAllRead();
        }}
        className="self-start rounded-md border border-night/20 px-3 py-1.5 text-sm font-semibold"
      >
        Mark all read
      </button>
      <FormFailureBand
        failure={failure}
        onRetry={() => {
          void onMarkAllRead();
        }}
        retryRef={retryRef}
      />
      {notifications.length === 0 ? (
        <p className="text-night/70">Nothing yet.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {notifications.map((notification) => (
            <li
              key={notification.id}
              className={`rounded-md border border-night/15 px-4 py-3 ${
                notification.read ? "bg-white" : "bg-hi-viz/20"
              }`}
            >
              <p className="m-0 text-night">{notification.body}</p>
              <Mono className="text-xs text-night/50">
                {new Date(notification.createdAt * 1000).toLocaleString()}
              </Mono>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
