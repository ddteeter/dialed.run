import { Link, createFileRoute } from "@tanstack/react-router";

import { NotificationBell } from "../../modules/notifications/components/NotificationBell";
import { UploadForm } from "../../modules/runs/components/UploadForm";
import {
  unreadNotificationCountFn,
} from "../../modules/notifications/functions";
import { Layout } from "../../ui";

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
    <Layout bell={<NotificationBell unreadCount={unreadCount} />}>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-8">
        <h1 className="m-0 font-display text-3xl uppercase leading-none">
          Log a run
        </h1>
        <UploadForm />
        <p className="text-center text-sm text-night/50">
          or{" "}
          <Link to="/runs/manual" className="font-semibold text-pink">
            enter it manually
          </Link>
        </p>
      </div>
    </Layout>
  );
}
