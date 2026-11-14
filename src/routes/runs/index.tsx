import { createFileRoute } from "@tanstack/react-router";

import { viewerUnitsQuery } from "../../modules/feed/functions";
import { BelledLayout } from "../../modules/notifications/components/BelledLayout";
import { bellStateFn } from "../../modules/notifications/functions";
import { RunList } from "../../modules/runs/components/RunList";
import { StravaRemindersLine } from "../../modules/runs/components/StravaRemindersLine";
import {
  getStravaStatusFn,
  listRunSummariesFn,
  didRetryRunWeatherFn,
  didSetRunConditionsFn,
} from "../../modules/runs/functions";
import { Page } from "../../ui";

export const Route = createFileRoute("/runs/")({
  staticData: { title: "Runs" },
  loader: async () => {
    const [runs, units, bell, strava] = await Promise.all([
      listRunSummariesFn(),
      viewerUnitsQuery(),
      bellStateFn(),
      getStravaStatusFn(),
    ]);
    return { runs, units, bell, strava };
  },
  component: RunsIndexPage,
});

function RunsIndexPage() {
  const { runs, units, bell, strava } = Route.useLoaderData();

  return (
    <BelledLayout {...bell}>
      <Page title="Runs">
        <StravaRemindersLine
          configured={strava.configured}
          connected={strava.connected}
        />
        <RunList
          runs={runs}
          units={units}
          actions={{
            setConditions: didSetRunConditionsFn,
            retryWeather: didRetryRunWeatherFn,
          }}
        />
      </Page>
    </BelledLayout>
  );
}
