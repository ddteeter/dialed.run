import { createFileRoute } from "@tanstack/react-router";

import { NotificationBell } from "../../modules/notifications/components/NotificationBell";
import { NotificationList } from "../../modules/notifications/components/NotificationList";
import {
  listNotificationsFn,
  unreadNotificationCountFn,
} from "../../modules/notifications/functions";
import { Layout } from "../../ui";

export const Route = createFileRoute("/notifications/")({
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
