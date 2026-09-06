import { createFileRoute } from "@tanstack/react-router";

import { NotificationBell } from "../../modules/runs/components/NotificationBell";
import { NotificationList } from "../../modules/runs/components/NotificationList";
import {
  listNotificationsFn,
  unreadNotificationCountFn,
} from "../../modules/runs/functions";
import { Layout } from "../../ui";

export const Route = createFileRoute("/runs/notifications")({
  loader: async () => ({
    notifications: await listNotificationsFn(),
    unreadCount: await unreadNotificationCountFn(),
  }),
  component: NotificationsPage,
});

function NotificationsPage() {
  const { notifications, unreadCount } = Route.useLoaderData();

  return (
    <Layout bell={<NotificationBell unreadCount={unreadCount} />}>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-8">
        <h1 className="m-0 font-display text-3xl uppercase leading-none">
          Notifications
        </h1>
        <NotificationList notifications={notifications} />
      </div>
    </Layout>
  );
}
