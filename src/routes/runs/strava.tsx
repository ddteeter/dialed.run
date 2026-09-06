import { createFileRoute } from "@tanstack/react-router";

import { NotificationBell } from "../../modules/runs/components/NotificationBell";
import { StravaConnect } from "../../modules/runs/components/StravaConnect";
import {
  getStravaStatusFn,
  unreadNotificationCountFn,
} from "../../modules/runs/functions";
import { Layout } from "../../ui";

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
    <Layout bell={<NotificationBell unreadCount={unreadCount} />}>
      <div className="mx-auto flex w-full max-w-sm flex-col gap-6 px-6 py-8">
        <h1 className="m-0 font-display text-3xl uppercase leading-none">
          Strava
        </h1>
        <p className="text-sm text-night/50">
          We never store your Strava activity data — connecting only turns
          on a reminder to log your kit after a run.
        </p>
        <StravaConnect configured={strava.configured} status={strava.status} />
      </div>
    </Layout>
  );
}
