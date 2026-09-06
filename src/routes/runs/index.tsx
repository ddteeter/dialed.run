import { Link, createFileRoute } from "@tanstack/react-router";

import { NotificationBell } from "../../modules/runs/components/NotificationBell";
import { RunList } from "../../modules/runs/components/RunList";
import {
  listRunsFn,
  unreadNotificationCountFn,
} from "../../modules/runs/functions";
import { Layout } from "../../ui";

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
    <Layout bell={<NotificationBell unreadCount={unreadCount} />}>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-8">
        <div className="flex items-center justify-between">
          <h1 className="m-0 font-display text-3xl uppercase leading-none">
            Runs
          </h1>
          <Link
            to="/runs/new"
            className="rounded-md bg-night px-4 py-2 font-semibold text-chalk"
          >
            + Add
          </Link>
        </div>
        <RunList runs={runs} />
      </div>
    </Layout>
  );
}
