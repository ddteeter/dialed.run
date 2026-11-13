import { Link, useNavigate } from "@tanstack/react-router";
import type { JSX, ReactNode } from "react";

import { viewerDayTimeLabel } from "../../../lib/dates";
import type { ViewerZone } from "../../../lib/dates";
import {
  ControlFailureBand,
  FormStatus,
  Icon,
  inFlight,
  Mono,
  PendingLabel,
  PhoneBell,
  useControlAction,
} from "../../../ui";
import type { listNotifications } from "../service";
import { notificationTarget, type NotificationTarget } from "../target";

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
  /**
   * Whose clock the times read on: the home place's, or marked UTC (R-96).
   */
  viewer: ViewerZone;
}

/**
 * Screen M, redrawn to S2c in round 22 (item 13) and to Round 55's 183
 * and 184.
 *
 * - **One `--panel` list** with hairline dividers: edge to edge on the
 *   phone, a hairline edge and RADIUS.card at desk (184b). **Unread is the
 *   pink dot and ink**, never a fill; read has no dot and is `--quiet`.
 * - **Every row is TYPE.body 400**, never underlined. A row that opens
 *   something is a link the row's width, ending in a `--muted` chevron; a
 *   row that opens nothing has none (183).
 * - **A 44 row above the list** (184a): the unread count in MONO.xs, and
 *   Mark all read at its right, on `useControlAction` (round 23, item 9):
 *   while it works its label breathes `[ Marking ]` and the rows stay as
 *   they are; on success the screen reloads; on failure the band says
 *   `Nothing marked`. Once nothing is unread the row stays and reads ALL
 *   READ, so the list never jumps.
 * - **Empty is S2b**, centred in the ruled panel (184c).
 *
 * `data-part` names are round 22's, so the conformance harness can find
 * the same regions on the board and here.
 */
export function NotificationList({
  notifications,
  markAllRead,
  viewer,
}: Readonly<NotificationListProps>) {
  return (
    <div className="flex flex-col gap-3">
      {/* The phone's bell ends the first row (Design 169.1). At 320
          (reflow) NOTIFICATIONS is wider than what the bell leaves it, so
          the word may break rather than push the bell off the screen. */}
      <div className="flex items-start gap-3">
        <h1 className="m-0 min-w-0 flex-1 font-display text-display uppercase wrap-anywhere">
          Notifications
        </h1>
        <PhoneBell />
      </div>
      <div className="flex flex-col">
        <MarkAllRow notifications={notifications} markAllRead={markAllRead} />
        {notifications.length === 0 ? (
          <Quiet />
        ) : (
          <ul
            data-part="notification-list"
            className={`flex list-none flex-col divide-y divide-hairline p-0 ${PANEL_CLASS}`}
          >
            {notifications.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                viewer={viewer}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * The list's one surface (184b): `--panel` with a hairline above and
 * below, edge to edge across the phone's 24 gutter; at desk a hairline
 * edge all round and RADIUS.card.
 */
const PANEL_CLASS =
  "m-0 -mx-6 border-y border-hairline bg-panel desk:mx-0 desk:overflow-hidden desk:rounded-card desk:border-x";

/**
 * 184a's row: the count at the left, Mark all read at the right while it
 * would clear something. An unread verdict reminder whose run still owes
 * one is not markable (the server leaves it unread), so it counts but is
 * offered no button that could only do nothing (PR #102 review).
 */
function MarkAllRow({
  notifications,
  markAllRead,
}: Readonly<Omit<NotificationListProps, "viewer">>): JSX.Element {
  const navigate = useNavigate();
  const marking = useControlAction({
    action: markAllRead,
    kicker: "Nothing marked",
    // Back to the same screen, so the loader re-runs and the rows come
    // back as the server now has them rather than as this guesses.
    onSuccess: () => navigate({ to: "/notifications" }),
  });
  const unread = notifications.filter(
    (notification) => !notification.read,
  ).length;
  const hasMarkable = notifications.some(
    (notification) => notification.markable,
  );
  return (
    <>
      <div
        data-part="mark-all-row"
        className="flex min-h-target items-center justify-between gap-4"
      >
        <Mono step="xs" className="text-muted">
          {unread === 0 ? "All read" : `${String(unread)} unread`}
        </Mono>
        {hasMarkable ? (
          <button
            type="button"
            data-part="mark-all"
            data-state={marking.pending ? "pending" : "rest"}
            {...inFlight(marking.pending)}
            onClick={() => {
              void marking.run();
            }}
            className="target cursor-pointer border-none bg-transparent p-0 text-body font-bold text-ink underline underline-offset-4"
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
    </>
  );
}

/**
S2b, confirmed verbatim, centred in the ruled panel (184c).
*/
function Quiet(): JSX.Element {
  return (
    <div
      data-part="notification-list"
      data-state="empty"
      className={`flex flex-col items-center gap-2 px-8 py-12 text-center ${PANEL_CLASS}`}
    >
      {/* A heading, as every other title-size line in the app is: a
          paragraph drawn as one is axe's `p-as-heading` (#566). */}
      <h2 className="m-0 font-display text-title uppercase">
        {/* Drawn, not said (D-150): a reader hears "Quiet". */}
        <span aria-hidden="true" className="text-action">
          [
        </span>{" "}
        Quiet{" "}
        <span aria-hidden="true" className="text-action">
          ]
        </span>
      </h2>
      <p className="m-0 text-lead">
        Log a run and we&rsquo;ll ask you one question about it. That&rsquo;s
        most of what lands here.
      </p>
    </div>
  );
}

/**
 * The row's two tones (183): unread is ink beside the dot, read is
 * `--quiet` with none. The row, link or not, is one shape.
 */
const ROW_CLASS = {
  unread: "flex items-start gap-3 px-6 py-3 text-ink no-underline",
  read: "flex items-start gap-3 px-6 py-3 text-quiet no-underline",
} as const;

function NotificationItem({
  notification,
  viewer,
}: Readonly<{
  notification: NotificationRow;
  viewer: ViewerZone;
}>): JSX.Element {
  const state = notification.read ? "read" : "unread";
  const target = notificationTarget(notification);
  const content = (
    <>
      {/* The dot's width is kept on a read row as indent, so the text
          column does not jump when a row is read. */}
      <span
        aria-hidden="true"
        className={`mt-2 block size-2 shrink-0 rounded-pill ${
          notification.read ? "" : "bg-action"
        }`}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        {/* The dot is what the eye gets; a screen reader gets the word. */}
        {notification.read ? undefined : (
          <span className="sr-only">Unread</span>
        )}
        {/* A second line, which a Decline's reason is, keeps its break
            (R48·129f). */}
        <span
          data-part="notification-body"
          className="text-body font-normal whitespace-pre-line"
        >
          {notification.body}
        </span>
        <Mono step="xs" className="text-muted">
          {viewerDayTimeLabel(notification.createdAt, viewer)}
        </Mono>
      </span>
      {target === undefined ? undefined : (
        <Icon
          name="forward"
          size={16}
          className="shrink-0 self-center text-muted"
        />
      )}
    </>
  );
  return (
    <li data-part="notification-row" data-state={state}>
      {target === undefined ? (
        <div className={ROW_CLASS[state]}>{content}</div>
      ) : (
        <TargetLink target={target} className={ROW_CLASS[state]}>
          {content}
        </TargetLink>
      )}
    </li>
  );
}

/**
 * Where a row goes (`notificationTarget`): the row's whole width is the
 * link, so its hit area is the row.
 */
function TargetLink({
  target,
  className,
  children,
}: Readonly<{
  target: NotificationTarget;
  className: string;
  children: ReactNode;
}>): JSX.Element {
  switch (target.to) {
    case "garment": {
      return (
        <Link
          to="/closet/$itemId"
          params={{ itemId: target.itemId }}
          className={className}
        >
          {children}
        </Link>
      );
    }
    case "profile": {
      return (
        <Link
          to="/feed/u/$handle"
          params={{ handle: target.handle }}
          className={className}
        >
          {children}
        </Link>
      );
    }
    case "own-profile": {
      return (
        <Link to="/feed/me" className={className}>
          {children}
        </Link>
      );
    }
    case "upload": {
      return (
        <Link to="/runs/new" className={className}>
          {children}
        </Link>
      );
    }
  }
}
