import { createFileRoute } from "@tanstack/react-router";

import { BelledLayout } from "../../modules/notifications/components/BelledLayout";
import { unreadNotificationCountFn } from "../../modules/notifications/functions";
import { ManualRunForm } from "../../modules/runs/components/ManualRunForm";
import { submitManualRun } from "../../modules/runs/functions";
import { Page } from "../../ui";

export const Route = createFileRoute("/runs/manual")({
  loader: async () => ({ unreadCount: await unreadNotificationCountFn() }),
  component: ManualRunPage,
});

function ManualRunPage() {
  const { unreadCount } = Route.useLoaderData();

  return (
    <BelledLayout unreadCount={unreadCount}>
      <Page title="Log a run" width="narrow">
        <ManualRunForm submitRun={submitManualRun} />
      </Page>
    </BelledLayout>
  );
}
