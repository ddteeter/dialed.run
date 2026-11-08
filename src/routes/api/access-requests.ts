import { createFileRoute } from "@tanstack/react-router";

import { env, primaryCoreDb } from "../../env";
import { receiveAccessRequest } from "../../modules/account";
import { deploymentPosture } from "../../modules/auth";
import { verifyTurnstileToken } from "../../modules/ops";

/**
 * The marketing site's request-access form (round 31, design 187). The
 * limit applies where Better Auth's does, on a real https deployment.
 */
export const Route = createFileRoute("/api/access-requests")({
  server: {
    handlers: {
      POST: ({ request }) =>
        receiveAccessRequest(request, {
          db: primaryCoreDb(),
          verify: verifyTurnstileToken,
          isLimited: deploymentPosture(env.BETTER_AUTH_URL).rateLimited,
        }),
    },
  },
});
