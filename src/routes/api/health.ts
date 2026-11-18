import { createFileRoute } from "@tanstack/react-router";

import { optionalVerifiedUserId } from "../../modules/auth";
import { healthResponse } from "../../modules/ops";

/**
 * The uptime check's URL. Anyone gets the status and `{ ok, version, at }`;
 * an operator also gets why (design 237). The viewer is asked of
 * `optionalVerifiedUserId`, as the Desk's door is (D-113 Q5), so an
 * operator whose address is unconfirmed is a stranger here.
 */
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => healthResponse((await optionalVerifiedUserId()) ?? ""),
    },
  },
});
