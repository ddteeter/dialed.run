import { createFileRoute } from "@tanstack/react-router";

import { defaultCardResponse } from "../../modules/ops/og/respond";

/**
 * The default share card (OPS-16; round 26 #22): what every page previews
 * as unless it is a shareable entry. `__root.tsx`'s default `og:image`
 * points here.
 */
export const Route = createFileRoute("/og/default")({
  server: {
    handlers: {
      GET: async ({ request }) => defaultCardResponse(request),
    },
  },
});
