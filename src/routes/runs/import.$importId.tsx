import { createFileRoute } from "@tanstack/react-router";

import { BelledLayout } from "../../modules/notifications/components/BelledLayout";
import { unreadNotificationCountFn } from "../../modules/notifications/functions";
import { ImportStatus } from "../../modules/runs/components/ImportStatus";
import { getImportStatusFn } from "../../modules/runs/functions";
import { Page } from "../../ui";

export const Route = createFileRoute("/runs/import/$importId")({
  loader: async () => ({ unreadCount: await unreadNotificationCountFn() }),
  component: ImportStatusPage,
});

function ImportStatusPage() {
  const { importId } = Route.useParams();
  const { unreadCount } = Route.useLoaderData();

  return (
    <BelledLayout unreadCount={unreadCount}>
      <Page title="Reading your run" width="narrow">
        <ImportStatus importId={importId} getStatus={getImportStatusFn} />
      </Page>
    </BelledLayout>
  );
}
