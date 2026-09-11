import { createFileRoute } from "@tanstack/react-router";

import { BelledLayout } from "../../modules/notifications/components/BelledLayout";
import { unreadNotificationCountFn } from "../../modules/notifications/functions";
import { RunDetail } from "../../modules/runs/components/RunDetail";
import { getRunFn, recordManualTempFn } from "../../modules/runs/functions";
import { runOrNotFound } from "../../modules/runs/not-found";
import { Page } from "../../ui";

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
    <BelledLayout unreadCount={unreadCount}>
      {/* No `title`: RunDetail renders the run's own heading. */}
      <Page>
        <RunDetail run={run} recordManualTemp={recordManualTempFn} />
      </Page>
    </BelledLayout>
  );
}
