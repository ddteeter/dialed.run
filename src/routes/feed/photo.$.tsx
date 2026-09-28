import { createFileRoute } from "@tanstack/react-router";

import { optionalUserId } from "../../modules/auth";
import { photoResponse } from "../../modules/feed/photos";

/**
 * Cached GET for entry photos (design doc "Photos"): the R2 key is the
 * splat, so keys with slashes (`entries/{userId}/{entryId}/{photoId}`)
 * round-trip unchanged. The rules live in `photoResponse`.
 */
export const Route = createFileRoute("/feed/photo/$")({
  server: {
    handlers: {
      GET: async ({ params }) =>
        photoResponse(params._splat, await optionalUserId()),
    },
  },
});
