import { createFileRoute } from "@tanstack/react-router";
import { drizzle } from "drizzle-orm/d1";

import { env } from "../../env";
import { nowSeconds } from "../../lib/now";
import { exportFileResponse } from "../../modules/account/data-exports";
import { sessionFromRequest } from "../../modules/auth";
import { optionalUserIdFrom } from "../../modules/auth/session-user";

/**
 * The export email's "Download export" (task 126, ACC-10; round 27 #13):
 * the runner's ZIP, for its owner, signed in, until it expires. Everything
 * it decides is `exportFileResponse`'s.
 */
export const Route = createFileRoute("/account/export/$token")({
  server: {
    handlers: {
      GET: async ({ request, params }) =>
        exportFileResponse(
          drizzle(env.DIALED_CORE),
          {
            token: params.token,
            userId: optionalUserIdFrom(await sessionFromRequest(request)),
          },
          env.IMPORTS,
          nowSeconds(),
        ),
    },
  },
});
