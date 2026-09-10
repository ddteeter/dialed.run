import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { Mono } from "../../../ui";
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

  async function onMarkAllRead() {
    setIsMarking(true);
    try {
      await markAllRead();
      await navigate({ to: "/notifications" });
    } finally {
      setIsMarking(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        disabled={isMarking}
        onClick={() => {
          void onMarkAllRead();
        }}
        className="self-start rounded-md border border-night/20 px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
      >
        Mark all read
      </button>
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
