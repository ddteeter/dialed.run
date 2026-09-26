import { Link, createFileRoute } from "@tanstack/react-router";

import { viewerUnitsQuery } from "../../modules/feed/functions";
import { BelledLayout } from "../../modules/notifications/components/BelledLayout";
import { unreadNotificationCountFn } from "../../modules/notifications/functions";
import { UploadForm } from "../../modules/runs/components/UploadForm";
import {
  getImportOutcomeFn,
  retimeRunFn,
  startFileImport,
} from "../../modules/runs/functions";
import { AddRunShell } from "../../modules/runs/components/AddRunShell";

/**
Screen A1: upload & auto-conditions (docs/product.md). Every outcome — the
parsed card, a duplicate's receipt, a parse failure, a stall — renders here,
in place; nothing navigates while a file is read (round 22).
*/
export const Route = createFileRoute("/runs/new")({
  loader: async () => ({
    units: await viewerUnitsQuery(),
    unreadCount: await unreadNotificationCountFn(),
  }),
  component: NewRunPage,
});

function NewRunPage() {
  const { units, unreadCount } = Route.useLoaderData();

  return (
    <BelledLayout unreadCount={unreadCount}>
      <AddRunShell>
        <UploadForm
          upload={startFileImport}
          getOutcome={getImportOutcomeFn}
          retime={retimeRunFn}
          units={units}
        />
        <p className="text-center text-small text-muted desk:max-w-column">
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
      </AddRunShell>
    </BelledLayout>
  );
}
