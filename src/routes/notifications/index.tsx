import { createFileRoute } from "@tanstack/react-router";

import { BelledLayout } from "../../modules/notifications/components/BelledLayout";
import { NotificationList } from "../../modules/notifications/components/NotificationList";
import {
  listNotificationsFn,
  markAllNotificationsReadFn,
  unreadNotificationCountFn,
} from "../../modules/notifications/functions";
import { Page } from "../../ui";

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
    <BelledLayout unreadCount={unreadCount}>
      <Page title="Notifications">
        <NotificationList
          notifications={notifications}
          markAllRead={markAllNotificationsReadFn}
        />
      </Page>
    </BelledLayout>
  );
}
