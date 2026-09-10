import { createFileRoute } from "@tanstack/react-router";

import { StravaCallbackResult } from "../../modules/runs/components/StravaCallbackResult";
import { completeStravaConnectFn } from "../../modules/runs/functions";
import { stravaCallbackSearch } from "../../modules/runs/inputs";

/**
Strava redirects here after the user approves (or denies) the connection.
The loader completes the exchange server-side so the code is a one-shot —
no button, no client state to get out of sync (design doc 102 §6).
*/
export const Route = createFileRoute("/runs/strava-callback")({
  validateSearch: stravaCallbackSearch,
  loaderDeps: ({ search }) => ({ ...search }),
  loader: ({ deps }) => completeStravaConnectFn({ data: deps }),
  component: StravaCallbackPage,
});

function StravaCallbackPage() {
  return <StravaCallbackResult result={Route.useLoaderData()} />;
}
