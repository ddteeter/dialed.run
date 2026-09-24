import { useNavigate } from "@tanstack/react-router";

import { dayTimeLabel } from "../../../lib/dates";
import {
  ControlFailureBand,
  FormStatus,
  inFlight,
  Mono,
  PendingLabel,
  useControlAction,
} from "../../../ui";
import type { listNotifications } from "../service";

type NotificationRow = Awaited<ReturnType<typeof listNotifications>>[number];

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

/**
 * Screen M, redrawn to S2c in round 22 (item 13).
 *
 * - **Unread is a white row and a pink dot**; read is the paper, its text
 *   in `--quiet`, the dot's width kept as indent. M's hi-viz wash is gone:
 *   *"yellow is the product's failure fill and nothing else."*
 * - **Mark all read** is a text button beside the heading, on
 *   `useControlAction` (round 23, item 9): while it works its label
 *   breathes `[ Marking ]` and the rows stay as they are; on success the
 *   screen reloads and they all go at once; on failure nothing changes and
 *   the band says `Nothing marked`. It only exists while something is
 *   unread — there is nothing for it to do otherwise.
 * - **Empty is S2b**, confirmed verbatim.
 *
 * `data-part` names are round 22's, so the conformance harness can find
 * the same regions on the board and here.
 */
export function NotificationList({
  notifications,
  markAllRead,
}: Readonly<NotificationListProps>) {
  const navigate = useNavigate();
  const marking = useControlAction({
    action: markAllRead,
    kicker: "Nothing marked",
    // Back to the same screen, so the loader re-runs and the rows come
    // back as the server now has them rather than as this guesses.
    onSuccess: () => navigate({ to: "/notifications" }),
  });
  // Offered only when it would clear something: an unread verdict
  // reminder whose run still owes one is not markable (the server leaves
  // it unread), and a button that changes nothing is a broken button.
  const hasMarkable = notifications.some(
    (notification) => notification.markable,
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="m-0 font-display text-display uppercase">
          Notifications
        </h1>
        {hasMarkable ? (
          <button
            type="button"
            data-part="mark-all"
            data-state={marking.pending ? "pending" : "rest"}
            {...inFlight(marking.pending)}
            onClick={() => {
              void marking.run();
            }}
            className="target cursor-pointer border-none bg-transparent p-0 text-body font-semibold text-ink"
          >
            <PendingLabel
              label="Mark all read"
              pendingLabel="Marking"
              pending={marking.pending}
            />
          </button>
        ) : undefined}
      </div>
      <ControlFailureBand
        failure={marking.failure}
        onRetry={marking.retry}
        retryRef={marking.retryRef}
      />
      <FormStatus>{marking.status}</FormStatus>
      {notifications.length === 0 ? (
        <div
          data-part="notification-list"
          data-state="empty"
          className="flex flex-col gap-3 py-8"
        >
          <p className="m-0 font-display text-title uppercase">
            <span className="text-action">[</span> Quiet{" "}
            <span className="text-action">]</span>
          </p>
          <p className="m-0 text-lead">
            Log a run and we&rsquo;ll ask you one question about it.
            That&rsquo;s most of what lands here.
          </p>
        </div>
      ) : (
        <ul
          data-part="notification-list"
          className="-mx-6 m-0 flex list-none flex-col p-0"
        >
          {notifications.map((notification) => (
            <li
              key={notification.id}
              data-part="notification-row"
              data-state={notification.read ? "read" : "unread"}
              className={`flex items-start gap-3 border-b border-hairline px-6 py-3 ${
                notification.read ? "text-quiet" : "bg-panel text-ink"
              }`}
            >
              {/* The dot's width is kept on a read row as indent, so the
                  text column does not jump when a row is read. */}
              <span
                aria-hidden="true"
                className={`mt-2 block size-2 shrink-0 rounded-pill ${
                  notification.read ? "" : "bg-action"
                }`}
              />
              <div className="flex flex-col gap-1">
                <p className="m-0 text-body">{notification.body}</p>
                <Mono step="xs" className="text-muted">
                  {dayTimeLabel(notification.createdAt)}
                </Mono>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
