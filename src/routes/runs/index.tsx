import { Link, createFileRoute } from "@tanstack/react-router";

import { BelledLayout } from "../../modules/notifications/components/BelledLayout";
import { unreadNotificationCountFn } from "../../modules/notifications/functions";
import { RunList } from "../../modules/runs/components/RunList";
import { listRunsFn } from "../../modules/runs/functions";
import { Page } from "../../ui";

export const Route = createFileRoute("/runs/")({
  loader: async () => ({
    runs: await listRunsFn(),
    unreadCount: await unreadNotificationCountFn(),
  }),
  component: RunsIndexPage,
});

function RunsIndexPage() {
  const { runs, unreadCount } = Route.useLoaderData();

  return (
    <BelledLayout unreadCount={unreadCount}>
      <Page
        title="Runs"
        headingAction={
          <Link
            to="/runs/new"
            className="rounded-md bg-night px-4 py-2 font-semibold text-chalk"
          >
            + Add
          </Link>
        }
      >
        <RunList runs={runs} />
        <Link to="/runs/strava" className="text-sm text-night/50 underline">
          Strava reminders
        </Link>
      </Page>
    </BelledLayout>
  );
}
