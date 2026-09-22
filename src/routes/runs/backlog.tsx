import { createFileRoute } from "@tanstack/react-router";

import {
  saveBacklogRowAction,
  verdictBacklogQuery,
  viewerUnitsQuery,
} from "../../modules/feed/functions";
import { BelledLayout } from "../../modules/notifications/components/BelledLayout";
import { unreadNotificationCountFn } from "../../modules/notifications/functions";
import { VerdictBacklog } from "../../modules/runs/components/VerdictBacklog";

/**
 * DS2, the verdict backlog — *"the one wide layout v1 earns that isn't
 * already drawn"*.
 *
 * Reached from "Clear the queue ›" on the feed and from the S1 verdict
 * prompt. The table decides nothing about how it is reached: whether the
 * queue is worth opening is `isBacklogWorthOpening`, asked where the link
 * is drawn, so arriving here with one row shows one row rather than
 * bouncing somebody who typed the URL.
 */
export const Route = createFileRoute("/runs/backlog")({
  loader: async () => ({
    backlog: await verdictBacklogQuery(),
    units: await viewerUnitsQuery(),
    unreadCount: await unreadNotificationCountFn(),
  }),
  component: VerdictBacklogPage,
});

function VerdictBacklogPage() {
  const { backlog, units, unreadCount } = Route.useLoaderData();

  return (
    <BelledLayout unreadCount={unreadCount}>
      <VerdictBacklog
        rows={backlog.rows}
        units={units}
        saveRow={saveBacklogRowAction}
      />
    </BelledLayout>
  );
}
