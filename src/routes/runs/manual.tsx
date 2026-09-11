import { createFileRoute } from "@tanstack/react-router";

import { BelledLayout } from "../../modules/notifications/components/BelledLayout";
import { unreadNotificationCountFn } from "../../modules/notifications/functions";
import { ManualRunForm } from "../../modules/runs/components/ManualRunForm";
import { submitManualRun } from "../../modules/runs/functions";
import { Page } from "../../ui";

// fallow-ignore-next-line code-duplication -- two routes of the same kind are the same shape by mandate: createFileRoute + loader + useLoaderData + shell is exactly what server-functions-are-glue requires, and the branching that would make them differ is what it forbids
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
