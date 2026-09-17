import { createFileRoute } from "@tanstack/react-router";

import { optionalUserId } from "../../modules/auth";
import { reviewerPhotoResponse } from "../../modules/feed/photos";

/**
 * The bytes behind a reported photo, for the review queue.
 *
 * Separate from `/feed/photo/$` because the rule is different, not looser:
 * that route asks whether the viewer may see the photo, and every photo in
 * this queue is hidden precisely because somebody reported it.
 * `reviewerPhotoResponse` requires an admin instead, and does it in a
 * module rather than here — a route may not branch, and a privilege test
 * in a loader is one no test can reach.
 */
export const Route = createFileRoute("/safety/review-photo/$")({
  server: {
    handlers: {
      GET: async ({ params }) =>
        reviewerPhotoResponse(
          params._splat ?? "",
          (await optionalUserId()) ?? "",
        ),
    },
  },
});
