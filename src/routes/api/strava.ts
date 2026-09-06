import { createFileRoute } from "@tanstack/react-router";
import { drizzle } from "drizzle-orm/d1";

import { env } from "../../env";
import { captureException } from "../../modules/ops";
import {
  handleStravaWebhookEvent,
  verifyStravaChallenge,
} from "../../modules/runs/strava/webhook";

/**
Strava reminder webhook (102 §6). GET is the one-time subscription
handshake; POST is every event delivery, which must always get a fast 200
(compliance + Strava's own requirement) regardless of payload shape.
*/
export const Route = createFileRoute("/api/strava")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const url = new URL(request.url);
        const result = verifyStravaChallenge(
          url.searchParams,
          env.STRAVA_WEBHOOK_VERIFY_TOKEN,
        );
        if (result === undefined) {
          return new Response("Forbidden", { status: 403 });
        }
        return Response.json({ "hub.challenge": result.challenge });
      },
      POST: async ({ request }) => {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          body = undefined;
        }
        await handleStravaWebhookEvent(
          drizzle(env.DIALED_CORE),
          env.IMPORTS_QUEUE,
          captureException,
          body,
        );
        return new Response(undefined, { status: 200 });
      },
    },
  },
});
