import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { viewerUnitsQuery } from "../../modules/feed/functions";
import { BelledLayout } from "../../modules/notifications/components/BelledLayout";
import { bellLoader } from "../../modules/notifications/components/bell-loader";
import { bellStateFn } from "../../modules/notifications/functions";
import { NotFoundState } from "../../modules/auth/components/SystemState";
import { RUN_NOT_FOUND } from "../../modules/runs/run-not-found";
import { DeleteRun } from "../../modules/runs/components/DeleteRun";
import { RunRemovals } from "../../modules/safety/components/RunRemovals";
import { runRemovalsQuery } from "../../modules/safety/functions";
import { RunDetail } from "../../modules/runs/components/RunDetail";
import {
  deleteRunFn,
  getRunSummaryFn,
  didRetryRunWeatherFn,
  didSetRunConditionsFn,
} from "../../modules/runs/functions";
import { beforeItsEntry, runOrNotFound } from "../../modules/runs/not-found";
import { Page } from "../../ui";

/**
The not-found's bell, read after mount (as the router's own not-found does).
*/
const loadBell = bellLoader(() => bellStateFn());

export const Route = createFileRoute("/runs/$runId")({
  loader: async ({ params }) => {
    const [run, units, bell, removals] = await Promise.all([
      getRunSummaryFn({ data: { runId: params.runId } }),
      viewerUnitsQuery(),
      bellStateFn(),
      runRemovalsQuery({ data: { runId: params.runId } }),
    ]);
    return {
      run: beforeItsEntry(runOrNotFound(run)),
      units,
      bell,
      removals,
    };
  },
  // Round 55 · 185: the missing thing named, in its own column.
  notFoundComponent: () => (
    <NotFoundState signedIn loadBell={loadBell} subject={RUN_NOT_FOUND} />
  ),
  component: RunDetailPage,
});

function RunDetailPage() {
  const { run, units, bell, removals } = Route.useLoaderData();
  const navigate = useNavigate();

  return (
    <BelledLayout {...bell}>
      <Page title="Run">
        {/* R-140: an entry the Desk removed, in its place. */}
        <RunRemovals removals={removals} />
        <RunDetail
          run={run}
          units={units}
          actions={{
            setConditions: didSetRunConditionsFn,
            retryWeather: didRetryRunWeatherFn,
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
