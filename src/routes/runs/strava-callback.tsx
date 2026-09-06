import { Link, createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { completeStravaConnectFn } from "../../modules/runs/functions";

const stravaCallbackSearchSchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
});

/**
Strava redirects here after the user approves (or denies) the connection.
The loader completes the exchange server-side so the code is a one-shot —
no button, no client state to get out of sync (design doc 102 §6).
*/
export const Route = createFileRoute("/runs/strava-callback")({
  validateSearch: stravaCallbackSearchSchema,
  loaderDeps: ({ search }) => ({ ...search }),
  loader: ({ deps }) => completeStravaConnectFn({ data: deps }),
  component: StravaCallbackPage,
});

function StravaCallbackPage() {
  const result = Route.useLoaderData();

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-4 px-6 py-16 text-center">
      <h1 className="m-0 font-display text-2xl uppercase leading-none">
        {result.ok ? "Connected" : "Not connected"}
      </h1>
      <p className="text-night/70">
        {result.ok
          ? "Strava is connected. We'll remind you to log your kit after a run."
          : result.reason}
      </p>
      <Link
        to="/runs/strava"
        className="rounded-md bg-night px-4 py-2 font-semibold text-chalk"
      >
        Back to Strava settings
      </Link>
    </div>
  );
}
