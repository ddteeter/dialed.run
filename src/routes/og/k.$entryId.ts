import { createFileRoute } from "@tanstack/react-router";

import { publicKitCardResponse } from "../../modules/feed/public-kit";

/**
 * A public kit's share card (round 41 #86e, D-151): the kit's own while it
 * is PUBLIC, the default card for every other reason. `/k/<id>`'s
 * `og:image` points here with a `?v=` of what the card shows, so an edit
 * is a new URL; the card served is always the kit as it is now.
 */
export const Route = createFileRoute("/og/k/$entryId")({
  server: {
    handlers: {
      GET: async ({ request, params }) =>
        publicKitCardResponse(request, params.entryId),
    },
  },
});
