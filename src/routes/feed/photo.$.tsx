import { createFileRoute } from "@tanstack/react-router";
import { optionalUserId } from "../../modules/auth";
import { getPhotoObject, isPhotoVisible } from "../../modules/feed/photos";

/**
 * Cached GET for entry photos (design doc "Photos"): the R2 key is the
 * splat, so keys with slashes (`entries/{userId}/{entryId}/{photoId}`)
 * round-trip unchanged. Same visibility rule as entry detail — a private
 * entry's photos are never fetchable by anyone but its owner.
 */
export const Route = createFileRoute("/feed/photo/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const key = params._splat;
        if (!key) return new Response("not found", { status: 404 });
        const viewerId = await optionalUserId();
        const isVisible = await isPhotoVisible(key, viewerId);
        if (!isVisible) return new Response("not found", { status: 404 });
        const object = await getPhotoObject(key);
        if (!object) return new Response("not found", { status: 404 });
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set("etag", object.httpEtag);
        headers.set("cache-control", "private, max-age=3600");
        return new Response(object.body, { headers });
      },
    },
  },
});
