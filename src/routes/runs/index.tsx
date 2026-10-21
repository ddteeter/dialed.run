import { Link, createFileRoute } from "@tanstack/react-router";

import { viewerUnitsQuery } from "../../modules/feed/functions";
import { BelledLayout } from "../../modules/notifications/components/BelledLayout";
import { bellStateFn } from "../../modules/notifications/functions";
import { RunList } from "../../modules/runs/components/RunList";
import {
  listRunSummariesFn,
  retryRunWeatherFn,
  setRunConditionsFn,
} from "../../modules/runs/functions";
import { Page } from "../../ui";

export const Route = createFileRoute("/runs/")({
  loader: async () => {
    const [runs, units, bell] = await Promise.all([
      listRunSummariesFn(),
      viewerUnitsQuery(),
      bellStateFn(),
    ]);
    return { runs, units, bell };
  },
  component: RunsIndexPage,
});

function RunsIndexPage() {
  const { runs, units, bell } = Route.useLoaderData();

  return (
    <BelledLayout {...bell}>
      <Page title="Runs">
        <RunList
          runs={runs}
          units={units}
          actions={{
            setConditions: setRunConditionsFn,
            retryWeather: retryRunWeatherFn,
          }}
        />
        <Link
          to="/runs/strava"
          className="target inline-flex items-center text-body text-muted underline"
        >
          Strava reminders
        </Link>
      </Page>
    </BelledLayout>
  );
}
