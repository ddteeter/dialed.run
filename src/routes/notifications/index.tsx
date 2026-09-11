import { createFileRoute } from "@tanstack/react-router";

import { BelledLayout } from "../../modules/notifications/components/BelledLayout";
import { NotificationList } from "../../modules/notifications/components/NotificationList";
import {
  listNotificationsFn,
  markAllNotificationsReadFn,
  unreadNotificationCountFn,
} from "../../modules/notifications/functions";
import { Page } from "../../ui";

// fallow-ignore-next-line code-duplication -- two routes of the same kind are the same shape by mandate: createFileRoute + loader + useLoaderData + shell is exactly what server-functions-are-glue requires, and the branching that would make them differ is what it forbids
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
