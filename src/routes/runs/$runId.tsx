import { createFileRoute } from "@tanstack/react-router";

import { NotificationBell } from "../../modules/notifications/components/NotificationBell";
import { unreadNotificationCountFn } from "../../modules/notifications/functions";
import { RunDetail } from "../../modules/runs/components/RunDetail";
import { getRunFn, recordManualTempFn } from "../../modules/runs/functions";
import { runOrNotFound } from "../../modules/runs/not-found";
import { Layout } from "../../ui";

export const Route = createFileRoute("/runs/$runId")({
  loader: async ({ params }) => {
    const [run, unreadCount] = await Promise.all([
      getRunFn({ data: { runId: params.runId } }),
      unreadNotificationCountFn(),
    ]);
    return { run: runOrNotFound(run), unreadCount };
  },
  component: RunDetailPage,
});

function RunDetailPage() {
  const { run, unreadCount } = Route.useLoaderData();

  return (
    <Layout bell={<NotificationBell unreadCount={unreadCount} />}>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-8">
        <RunDetail run={run} recordManualTemp={recordManualTempFn} />
      </div>
    </Layout>
  );
}
