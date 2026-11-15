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
import { runListDeps, runListSearch } from "../../modules/runs/inputs";
import { Page } from "../../ui";

export const Route = createFileRoute("/runs/")({
  staticData: { title: "Runs" },
  validateSearch: runListSearch,
  loaderDeps: ({ search }) => runListDeps(search),
  loader: async ({ deps }) => {
    const [page, units, bell, strava] = await Promise.all([
      listRunSummariesFn({ data: deps }),
      viewerUnitsQuery(),
      bellStateFn(),
      getStravaStatusFn(),
    ]);
    return { page, show: deps.show, units, bell, strava };
  },
  component: RunsIndexPage,
});

function RunsIndexPage() {
  const { page, show, units, bell, strava } = Route.useLoaderData();

  return (
    <BelledLayout {...bell}>
      <Page title="Runs">
        <StravaRemindersLine
          configured={strava.configured}
          connected={strava.connected}
        />
        <RunList
          page={page}
          show={show}
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
