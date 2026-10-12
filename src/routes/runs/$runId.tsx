import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { viewerUnitsQuery } from "../../modules/feed/functions";
import { BelledLayout } from "../../modules/notifications/components/BelledLayout";
import { bellStateFn } from "../../modules/notifications/functions";
import { DeleteRun } from "../../modules/runs/components/DeleteRun";
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
    const [run, units, bell] = await Promise.all([
      getRunSummaryFn({ data: { runId: params.runId } }),
      viewerUnitsQuery(),
      bellStateFn(),
    ]);
    return { run: beforeItsEntry(runOrNotFound(run)), units, bell };
  },
  component: RunDetailPage,
});

function RunDetailPage() {
  const { run, units, bell } = Route.useLoaderData();
  const navigate = useNavigate();

  return (
    <BelledLayout {...bell}>
      <Page title="Run" width="panel">
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
