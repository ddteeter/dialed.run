/**
 * Which requests under `/api/auth/` reach Better Auth (SA-M36): only a
 * path one of its endpoints serves. Its limiter keys a row by address and
 * path before its router looks the path up, so a path it serves nothing
 * at would otherwise still be a new row; such a request is answered 404
 * here, as its router would answer it, without the handler.
 */

/**
Better Auth's mount point: its default `basePath`, which `createAuth` keeps.
*/
const AUTH_BASE = "/api/auth";

/**
 * The paths an API object's endpoints are served at: every function on it
 * that carries a `path`, as Better Auth's endpoints do.
 */
export function endpointPaths(api: object): string[] {
  return Object.values(api)
    .map((endpoint: unknown) => pathOf(endpoint))
    .filter((path) => path !== undefined);
}

/**
An endpoint's `path`, read without trusting its shape.
*/
function pathOf(endpoint: unknown): string | undefined {
  return typeof endpoint === "function" &&
    "path" in endpoint &&
    typeof endpoint.path === "string"
    ? endpoint.path
    : undefined;
}

/**
 * Whether a path, under the mount, is one of `paths`: each segment equal,
 * a `:name` segment any non-empty one.
 */
export function authPathMatcher(
  paths: readonly string[],
): (path: string) => boolean {
  const patterns = [...new Set(paths)].map((path) => path.split("/"));
  return (path) => {
    const segments = path.split("/");
    return patterns.some(
      (pattern) =>
        pattern.length === segments.length &&
        pattern.every((part, index) =>
          part.startsWith(":")
            ? segments[index] !== ""
            : part === segments[index],
        ),
    );
  };
}

/**
 * Hand a request to `handle` when its path is one Better Auth serves;
 * answer anything else 404 without it.
 */
export function answerAuthRequest(
  request: Request,
  isAuthPath: (path: string) => boolean,
  handle: (request: Request) => Promise<Response>,
): Promise<Response> {
  const { pathname } = new URL(request.url);
  const isServed =
    pathname.startsWith(`${AUTH_BASE}/`) &&
    isAuthPath(pathname.slice(AUTH_BASE.length));
  return isServed
    ? handle(request)
    : Promise.resolve(new Response(undefined, { status: 404 }));
}
