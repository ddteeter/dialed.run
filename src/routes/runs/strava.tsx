import { createFileRoute } from "@tanstack/react-router";

import { BelledLayout } from "../../modules/notifications/components/BelledLayout";
import { bellStateFn } from "../../modules/notifications/functions";
import { withBell } from "../../modules/notifications/with-bell";
import { StravaConnect } from "../../modules/runs/components/StravaConnect";
import {
  disconnectStravaFn,
  getStravaStatusFn,
} from "../../modules/runs/functions";
import { tryAgainSearch } from "../../lib/strava-origin";
import { Page } from "../../ui";

export const Route = createFileRoute("/runs/strava")({
  // `again`: back from a refused receipt's Try again (round 39 #66).
  validateSearch: tryAgainSearch,
  loader: async () => withBell(getStravaStatusFn(), bellStateFn()),
  component: StravaPage,
});

function StravaPage() {
  const { data: strava, bell } = Route.useLoaderData();
  const { again } = Route.useSearch();

  return (
    <BelledLayout {...bell}>
      <Page title="Strava" width="column" focusTitle={again === true}>
        <p className="text-small text-muted">
          We never store your Strava activity data — connecting only turns on a
          reminder to log your kit after a run.
        </p>
        <p className="text-small text-muted">
          If that seems like more work than it needs to be, we agree. Take it up
          with Strava&rsquo;s terms of use.
        </p>
        <StravaConnect
          configured={strava.configured}
          connected={strava.connected}
          lastRunSeenAt={strava.lastRunSeenAt}
          runCount={strava.runCount}
          disconnect={disconnectStravaFn}
        />
      </Page>
    </BelledLayout>
  );
}
