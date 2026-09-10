import { createFileRoute } from "@tanstack/react-router";

import { ImportStatus } from "../../modules/runs/components/ImportStatus";
import { getImportStatusFn } from "../../modules/runs/functions";
import { NotificationBell } from "../../modules/notifications/components/NotificationBell";
import {
  unreadNotificationCountFn,
} from "../../modules/notifications/functions";
import { Layout } from "../../ui";

export const Route = createFileRoute("/runs/import/$importId")({
  loader: async () => ({ unreadCount: await unreadNotificationCountFn() }),
  component: ImportStatusPage,
});

function ImportStatusPage() {
  const { importId } = Route.useParams();
  const { unreadCount } = Route.useLoaderData();

  return (
    <Layout bell={<NotificationBell unreadCount={unreadCount} />}>
      <div className="mx-auto flex w-full max-w-sm flex-col gap-6 px-6 py-8">
        <h1 className="m-0 font-display text-3xl uppercase leading-none">
          Reading your run
        </h1>
        <ImportStatus importId={importId} getStatus={getImportStatusFn} />
      </div>
    </Layout>
  );
}
