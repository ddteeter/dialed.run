import { createFileRoute } from "@tanstack/react-router";

import { env } from "../../env";
import { captureException } from "../../modules/ops/sentry";
import {
  stravaDeliveryResponse,
  stravaHandshakeResponse,
} from "../../modules/runs/strava";

/**
Strava reminder webhook (102 §6), at the callback URL the subscription was
registered with: `/api/strava/<STRAVA_WEBHOOK_PATH_SECRET>` (SA-M6). GET
is the one-time subscription handshake; POST is every event delivery.
Both answer 404 at any other key.
*/
export const Route = createFileRoute("/api/strava/$key")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        stravaHandshakeResponse(
          params.key,
          env.STRAVA_WEBHOOK_PATH_SECRET,
          new URL(request.url).searchParams,
          env.STRAVA_WEBHOOK_VERIFY_TOKEN,
        ),
      POST: ({ request, params }) =>
        stravaDeliveryResponse(
          params.key,
          env.STRAVA_WEBHOOK_PATH_SECRET,
          request,
          env.IMPORTS_QUEUE,
          captureException,
          env.STRAVA_SUBSCRIPTION_ID,
        ),
    },
  },
});
