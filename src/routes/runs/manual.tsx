import { createFileRoute } from "@tanstack/react-router";

import { ManualRunForm } from "../../modules/runs/components/ManualRunForm";
import { NotificationBell } from "../../modules/notifications/components/NotificationBell";
import {
  unreadNotificationCountFn,
} from "../../modules/notifications/functions";
import { Layout } from "../../ui";

export const Route = createFileRoute("/runs/manual")({
  loader: async () => ({ unreadCount: await unreadNotificationCountFn() }),
  component: ManualRunPage,
});

function ManualRunPage() {
  const { unreadCount } = Route.useLoaderData();

  return (
    <Layout bell={<NotificationBell unreadCount={unreadCount} />}>
      <div className="mx-auto flex w-full max-w-sm flex-col gap-6 px-6 py-8">
        <h1 className="m-0 font-display text-3xl uppercase leading-none">
          Log a run
        </h1>
        <ManualRunForm />
      </div>
    </Layout>
  );
}
