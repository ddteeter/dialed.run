import { createFileRoute } from "@tanstack/react-router";

import { optionalUserId } from "../../modules/auth";
import { photoResponse, signedQueryOf } from "../../modules/feed/photos";

/**
 * Cached GET for entry photos (design doc "Photos"): the R2 key is the
 * splat, so keys with slashes (`entries/{userId}/{entryId}/{photoId}`)
 * round-trip unchanged, and a signed URL's expiry and signature ride in
 * the query (task 128 · SAF-7). The rules live in `photoResponse`.
 */
export const Route = createFileRoute("/feed/photo/$")({
  server: {
    handlers: {
      GET: async ({ params, request }) =>
        photoResponse(
          params._splat,
          await optionalUserId(),
          signedQueryOf(request.url),
        ),
    },
  },
});
