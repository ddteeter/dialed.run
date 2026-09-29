import { createFileRoute } from "@tanstack/react-router";
import { drizzle } from "drizzle-orm/d1";

import { env } from "../../env";
import { nowSeconds } from "../../lib/now";
import { exportDownload } from "../../modules/account/export";
import { sessionFromRequest } from "../../modules/auth";
import { optionalUserIdFrom } from "../../modules/auth/session-user";

/**
 * "Export your data" · Get a copy (task 126, ACC-10): the runner's own
 * JSON file, as a download. Everything it decides is `exportDownload`'s.
 */
export const Route = createFileRoute("/account/export")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        exportDownload(
          optionalUserIdFrom(await sessionFromRequest(request)),
          drizzle(env.DIALED_CORE),
          new URL(request.url).origin,
          nowSeconds(),
        ),
    },
  },
});
