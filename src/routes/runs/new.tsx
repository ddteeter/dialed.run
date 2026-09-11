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
      <Page title="Log a run">
        <UploadForm upload={startFileImport} />
        <p className="text-center text-sm text-night/50">
          or{" "}
          <Link to="/runs/manual" className="font-semibold text-pink">
            enter it manually
          </Link>
        </p>
      </Page>
    </BelledLayout>
  );
}
