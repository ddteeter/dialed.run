import { createFileRoute } from "@tanstack/react-router";
import { drizzle } from "drizzle-orm/d1";

import { env } from "../../env";
import { sessionFromRequest } from "../../modules/auth";
import { getItemPhotoObject } from "../../modules/closet/photos";
import { NotFoundError } from "../../modules/closet/service";

/**
 * Owner-scoped cached photo GET (packet §5 + design doc open question #3:
 * private for now — revisit if another lane needs garment photos). 404 for
 * both "no such item" and "not yours" so existence never leaks.
 */
export const Route = createFileRoute("/closet/photo/$itemId/$size")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await sessionFromRequest(request);
        if (!session) return new Response("Unauthorized", { status: 401 });

        const db = drizzle(env.DIALED_CORE);
        try {
          const object = await getItemPhotoObject(
            db,
            session.user.id,
            params.itemId,
            params.size,
            request.headers.get("if-none-match"),
          );
          if (!object) return new Response("Not found", { status: 404 });
          const headers = new Headers();
          object.writeHttpMetadata(headers);
          headers.set("etag", object.httpEtag);
          headers.set("cache-control", "private, max-age=31536000, immutable");
          // R2 returns no body when the caller's etag still matches, so the
          // bytes are never read or streamed — a 304 instead of the image.
          if (!("body" in object)) return new Response(undefined, { status: 304, headers });
          return new Response(object.body, { headers });
        } catch (error) {
          if (error instanceof NotFoundError) {
            return new Response("Not found", { status: 404 });
          }
          throw error;
        }
      },
    },
  },
});
