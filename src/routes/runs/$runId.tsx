import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { viewerUnitsQuery } from "../../modules/feed/functions";
import { BelledLayout } from "../../modules/notifications/components/BelledLayout";
import { unreadNotificationCountFn } from "../../modules/notifications/functions";
import { DeleteRun } from "../../modules/runs/components/DeleteRun";
import { RunRemovals } from "../../modules/safety/components/RunRemovals";
import { runRemovalsQuery } from "../../modules/safety/functions";
import { RunDetail } from "../../modules/runs/components/RunDetail";
import {
  deleteRunFn,
  getRunSummaryFn,
  retryRunWeatherFn,
  setRunConditionsFn,
} from "../../modules/runs/functions";
import { beforeItsEntry, runOrNotFound } from "../../modules/runs/not-found";
import { Page } from "../../ui";

export const Route = createFileRoute("/runs/$runId")({
  loader: async ({ params }) => {
    const [run, units, unreadCount, removals] = await Promise.all([
      getRunSummaryFn({ data: { runId: params.runId } }),
      viewerUnitsQuery(),
      unreadNotificationCountFn(),
      runRemovalsQuery({ data: { runId: params.runId } }),
    ]);
    return {
      run: beforeItsEntry(runOrNotFound(run)),
      units,
      unreadCount,
      removals,
    };
  },
  component: RunDetailPage,
});

function RunDetailPage() {
  const { run, units, unreadCount, removals } = Route.useLoaderData();
  const navigate = useNavigate();

  return (
    <BelledLayout unreadCount={unreadCount}>
      <Page title="Run" width="panel">
        {/* R-140: an entry the Desk removed, in its place. */}
        <RunRemovals removals={removals} />
        <RunDetail
          run={run}
          units={units}
          actions={{
            setConditions: setRunConditionsFn,
            retryWeather: retryRunWeatherFn,
          }}
        />
        <DeleteRun
          runId={run.id}
          deleteRun={deleteRunFn}
          onDeleted={async () => {
            await navigate({ to: "/runs" });
          }}
        />
      </Page>
    </BelledLayout>
  );
}
