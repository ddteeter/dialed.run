import { createFileRoute } from "@tanstack/react-router";

import { BelledLayout } from "../../modules/notifications/components/BelledLayout";
import { unreadNotificationCountFn } from "../../modules/notifications/functions";
import { StravaConnect } from "../../modules/runs/components/StravaConnect";
import {
  disconnectStravaFn,
  getStravaAuthorizeUrlFn,
  getStravaStatusFn,
} from "../../modules/runs/functions";
import { Page } from "../../ui";

export const Route = createFileRoute("/runs/strava")({
  loader: async () => {
    const [strava, unreadCount] = await Promise.all([
      getStravaStatusFn(),
      unreadNotificationCountFn(),
    ]);
    return { strava, unreadCount };
  },
  component: StravaPage,
});

function StravaPage() {
  const { strava, unreadCount } = Route.useLoaderData();

  return (
    <BelledLayout unreadCount={unreadCount}>
      <Page title="Strava" width="narrow">
        <p className="text-sm text-night/50">
          We never store your Strava activity data — connecting only turns on
          a reminder to log your kit after a run.
        </p>
        <p className="text-sm text-night/50">
          If that seems like more work than it needs to be, we agree. Take it
          up with Strava&rsquo;s terms of use.
        </p>
        <StravaConnect
          configured={strava.configured}
          status={strava.status}
          getAuthorizeUrl={getStravaAuthorizeUrlFn}
          disconnect={disconnectStravaFn}
        />
      </Page>
    </BelledLayout>
  );
}
