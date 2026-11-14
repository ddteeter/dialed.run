import { createFileRoute } from "@tanstack/react-router";

import { BelledLayout } from "../../modules/notifications/components/BelledLayout";
import { NotificationList } from "../../modules/notifications/components/NotificationList";
import {
  bellStateFn,
  listNotificationsFn,
  markAllNotificationsReadFn,
  viewerZoneFn,
} from "../../modules/notifications/functions";
import { withBell } from "../../modules/notifications/with-bell";
import { Page } from "../../ui";

// fallow-ignore-next-line code-duplication -- two routes of the same kind are the same shape by mandate: createFileRoute + loader + useLoaderData + shell is exactly what server-functions-are-glue requires, and the branching that would make them differ is what it forbids
export const Route = createFileRoute("/notifications/")({
  staticData: { title: "Notifications" },
  loader: () =>
    withBell(
      Promise.all([listNotificationsFn(), viewerZoneFn()]),
      bellStateFn(),
    ),
  component: NotificationsPage,
});

/**
 * DS3: notifications is a panel at desk, not a 620 column (R-102). The
 * heading is the list's own, because Mark all read sits beside it and
 * holds state a route may not.
 */
function NotificationsPage() {
  const { data, bell } = Route.useLoaderData();
  const [notifications, viewer] = data;

  return (
    <BelledLayout {...bell}>
      <Page>
        <NotificationList
          notifications={notifications}
          markAllRead={markAllNotificationsReadFn}
          viewer={viewer}
        />
      </Page>
    </BelledLayout>
  );
}
