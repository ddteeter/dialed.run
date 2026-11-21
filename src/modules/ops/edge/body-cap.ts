/**
 * The most of a request body the Worker reads (SA-L05), decided before the
 * framework parses it: TanStack Start reads a server function's whole
 * multipart body into a `FormData` before its validator or its sign-in
 * check runs, so a size check on the `File` comes after the bytes are held.
 *
 * Three ceilings. Auth's endpoints (`/api/auth/*`) take small forms only,
 * so their bodies have the smallest, whatever they say they carry. Elsewhere
 * a multipart upload may carry the largest file any upload takes (a run
 * file) with room for its form, and anything else is far smaller. `Content-Length` is a claim, so it is only the
 * early refusal; the body is also counted as it is read
 * (`readCappedBytes`), and either way the answer is a 413.
 */
import { readCappedBytes } from "../../../lib/read-capped";
import { maxPhotoBytes } from "../../../lib/photo-constraints";
import { MAX_IMPORT_BYTES } from "../../runs";

const MEGABYTE = 1024 * 1024;

export const MULTIPART_BODY_LIMIT =
  Math.max(MAX_IMPORT_BYTES, maxPhotoBytes) + MEGABYTE;

export const OTHER_BODY_LIMIT = MEGABYTE;

/**
 * Auth's ceiling (owner, 2026-11-21): 8 KiB, several times the largest
 * form the app posts there (sign-up's).
 */
export const AUTH_BODY_LIMIT = 8 * 1024;

/**
Where Better Auth is mounted: every path under it takes auth's ceiling.
*/
const AUTH_PREFIX = "/api/auth/";

class BodyTooLarge extends Error {}

/**
 * The ceiling for a request: auth's by its path, otherwise by what it says
 * it carries.
 */
export function bodyLimitFor(request: Request): number {
  if (new URL(request.url).pathname.startsWith(AUTH_PREFIX)) {
    return AUTH_BODY_LIMIT;
  }
  // `String(null)` is "null", which is not multipart: no header needs no
  // branch of its own.
  const type = String(request.headers.get("content-type"));
  return type.toLowerCase().startsWith("multipart/form-data")
    ? MULTIPART_BODY_LIMIT
    : OTHER_BODY_LIMIT;
}

/**
 * The request the app reads, its body read under the ceiling, or the 413
 * that answers it instead. A request with no body passes as it is.
 */
export async function boundedRequest(
  request: Request,
): Promise<Request | Response> {
  if (request.body === null) return request;
  let body: Uint8Array<ArrayBuffer>;
  try {
    body = await readCappedBytes(
      request,
      bodyLimitFor(request),
      () => new BodyTooLarge(),
    );
  } catch (error) {
    if (error instanceof BodyTooLarge) {
      return new Response("Request body too large", { status: 413 });
    }
    throw error;
  }
  return new Request(request, { method: request.method, body });
}
