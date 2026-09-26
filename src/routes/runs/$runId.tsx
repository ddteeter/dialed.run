import { createFileRoute } from "@tanstack/react-router";

import { viewerUnitsQuery } from "../../modules/feed/functions";
import { BelledLayout } from "../../modules/notifications/components/BelledLayout";
import { unreadNotificationCountFn } from "../../modules/notifications/functions";
import { RunDetail } from "../../modules/runs/components/RunDetail";
import {
  getRunSummaryFn,
  retryRunWeatherFn,
  setRunConditionsFn,
} from "../../modules/runs/functions";
import { beforeItsEntry, runOrNotFound } from "../../modules/runs/not-found";
import { Page } from "../../ui";

export const Route = createFileRoute("/runs/$runId")({
  loader: async ({ params }) => {
    const [run, units, unreadCount] = await Promise.all([
      getRunSummaryFn({ data: { runId: params.runId } }),
      viewerUnitsQuery(),
      unreadNotificationCountFn(),
    ]);
    return { run: beforeItsEntry(runOrNotFound(run)), units, unreadCount };
  },
  component: RunDetailPage,
});

function RunDetailPage() {
  const { run, units, unreadCount } = Route.useLoaderData();

  return (
    <BelledLayout unreadCount={unreadCount}>
      <Page title="Run" width="panel">
        <RunDetail
          run={run}
          units={units}
          actions={{
            setConditions: setRunConditionsFn,
            retryWeather: retryRunWeatherFn,
          }}
        />
      </Page>
    </BelledLayout>
  );
}
