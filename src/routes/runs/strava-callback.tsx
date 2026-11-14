import { createFileRoute } from "@tanstack/react-router";

import { BelledLayout } from "../../modules/notifications/components/BelledLayout";
import { bellStateFn } from "../../modules/notifications/functions";
import { StravaCallbackResult } from "../../modules/runs/components/StravaCallbackResult";
import {
  completeStravaConnectFn,
  getStravaStatusFn,
} from "../../modules/runs/functions";
import { stravaCallbackSearch } from "../../modules/runs/inputs";

/**
Strava redirects here after the user approves (or denies) the connection.
The loader completes the exchange server-side so the code is a one-shot —
no button, no client state to get out of sync (design doc 102 §6).
*/
export const Route = createFileRoute("/runs/strava-callback")({
  validateSearch: stravaCallbackSearch,
  loaderDeps: ({ search }) => ({ ...search }),
  loader: async ({ deps }) => {
    const [{ result, from }, bell] = await Promise.all([
      completeStravaConnectFn({ data: deps }),
      bellStateFn(),
    ]);
    // After the exchange: whether Strava is configured is asked once the
    // answer is in, as it always was.
    const { configured } = await getStravaStatusFn();
    return { result, from, configured, bell };
  },
  component: StravaCallbackPage,
});

function StravaCallbackPage() {
  const { result, from, configured, bell } = Route.useLoaderData();
  // The shell, as /runs/strava wears it (D1-15, P2a-09): the bell, the
  // tabs, and the title where T1 puts it.
  return (
    <BelledLayout {...bell}>
      <StravaCallbackResult
        result={result}
        from={from}
        configured={configured}
      />
    </BelledLayout>
  );
}
