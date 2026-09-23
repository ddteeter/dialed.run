import { Link, createFileRoute } from "@tanstack/react-router";

import { BelledLayout } from "../../modules/notifications/components/BelledLayout";
import { unreadNotificationCountFn } from "../../modules/notifications/functions";
import { UploadForm } from "../../modules/runs/components/UploadForm";
import { startFileImport } from "../../modules/runs/functions";
import { Page } from "../../ui";

/**
Screen A1: upload & auto-conditions (docs/product.md). The dupe-warning
and manual-temp fallback live on the import-status and run-detail screens
this flow lands on, not here.
*/
export const Route = createFileRoute("/runs/new")({
  loader: async () => ({ unreadCount: await unreadNotificationCountFn() }),
  component: NewRunPage,
});

function NewRunPage() {
  const { unreadCount } = Route.useLoaderData();

  return (
    <BelledLayout unreadCount={unreadCount}>
      <Page title="Add a run">
        <UploadForm upload={startFileImport} />
        <p className="text-center text-small text-muted">
          No file?{" "}
          <Link
            to="/runs/manual"
            data-target="inline"
            className="font-semibold text-cold-text"
          >
            Enter the run by hand
          </Link>{" "}
          instead.
        </p>
      </Page>
    </BelledLayout>
  );
}
