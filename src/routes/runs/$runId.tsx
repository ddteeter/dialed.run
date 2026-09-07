import { createFileRoute } from "@tanstack/react-router";

import { NotificationBell } from "../../modules/notifications/components/NotificationBell";
import { RunDetail } from "../../modules/runs/components/RunDetail";
import {
  getRunFn,
} from "../../modules/runs/functions";
import {
  unreadNotificationCountFn,
} from "../../modules/notifications/functions";
import { Layout } from "../../ui";

/**
TanStack's own `notFound()` returns a plain options object rather than an
Error (thrown or returned, per its docs) — `only-throw-error` rejects
throwing it directly, so this wraps it in a real Error that still carries
the `isNotFound` marker the router's `isNotFound()` check duck-types on.
*/
class RunNotFoundError extends Error {
  readonly isNotFound = true;
}

export const Route = createFileRoute("/runs/$runId")({
  loader: async ({ params }) => {
    const [run, unreadCount] = await Promise.all([
      getRunFn({ data: { runId: params.runId } }),
      unreadNotificationCountFn(),
    ]);
    if (run === undefined) throw new RunNotFoundError("Run not found.");
    return { run, unreadCount };
  },
  component: RunDetailPage,
});

function RunDetailPage() {
  const { run, unreadCount } = Route.useLoaderData();

  return (
    <Layout bell={<NotificationBell unreadCount={unreadCount} />}>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-8">
        <RunDetail run={run} />
      </div>
    </Layout>
  );
}
