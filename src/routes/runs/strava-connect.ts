import { createFileRoute } from "@tanstack/react-router";

import { optionalUserId } from "../../modules/auth";
import { newUlid } from "../../lib/ids";
import { stravaConnectSearch } from "../../lib/strava-origin";
import { stravaConfigFromEnv } from "../../modules/runs/strava/api-from-env";
import { stravaConnectRedirect } from "../../modules/runs/strava/oauth";

/**
 * Where Strava's official Connect button points (task 127, STR-7): mints
 * the OAuth `state` nonce and redirects to Strava. The rules are
 * `stravaConnectRedirect`'s.
 */
export const Route = createFileRoute("/runs/strava-connect")({
  // Types the button's link; `stravaConnectRedirect` parses what arrives.
  validateSearch: stravaConnectSearch,
  server: {
    handlers: {
      GET: async ({ request }) =>
        stravaConnectRedirect({
          userId: await optionalUserId(),
          config: stravaConfigFromEnv(),
          origin: new URL(request.url).origin,
          state: newUlid(),
          from: new URL(request.url).searchParams.get("from"),
        }),
    },
  },
});
