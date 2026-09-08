import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { Mono } from "../../../ui";
import { markAllNotificationsReadFn } from "../functions";
import type { listNotifications } from "../service";

type NotificationRow = Awaited<
  ReturnType<typeof listNotifications>
>[number];

export function NotificationList({
  notifications,
}: Readonly<{ notifications: readonly NotificationRow[] }>) {
  const navigate = useNavigate();
  const [isMarking, setIsMarking] = useState(false);

  async function markAllRead() {
    setIsMarking(true);
    try {
      await markAllNotificationsReadFn();
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
          void markAllRead();
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
