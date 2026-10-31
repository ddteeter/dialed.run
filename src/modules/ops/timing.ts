/**
 * Server timing (design 165, part 2): one structured log line per request,
 * named by route id, so Workers Logs' Query Builder can chart p50/p95 per
 * screen with no binding of its own.
 *
 * `ms` runs until the `Response` exists, which for a streamed SSR page is
 * its time to first byte; the invocation's own wall time, which Workers
 * Logs records beside this line, covers the rest of the body.
 */
import { leafRouteIds, routeMatcher } from "../../lib/route-ids";
import { captureException } from "./sentry";

/**
TanStack Start's prefix for a server function call.
*/
const SERVER_FN_PREFIX = "/_serverFn/";

/**
 * What a request is called in the log. A server function goes by its id,
 * which in production is a stable hash of its file and name; anything no
 * route matches is `unmatched`, so a scanner's thousand paths are one
 * value rather than a thousand.
 */
export type RequestNamer = (pathname: string) => string;

const UNMATCHED = "unmatched";

/**
 * A namer for this route tree. Nothing is built until the first request
 * asks, so `server.ts` can hold one at module scope; and a tree it cannot
 * read is reported once and degrades to naming every page `unmatched`
 * (law 5): a changed generator must never stop the Worker answering.
 */
export function requestNamer(
  tree: unknown,
  report: (error: unknown) => void = (error) => {
    captureException(error, { surface: "timing" });
  },
): RequestNamer {
  let pageName: RequestNamer | undefined;
  const namePage = (): RequestNamer => {
    if (pageName !== undefined) return pageName;
    try {
      const match = routeMatcher(leafRouteIds(tree));
      pageName = (pathname) => match(pathname) ?? UNMATCHED;
    } catch (error) {
      report(error);
      pageName = () => UNMATCHED;
    }
    return pageName;
  };
  return (pathname) =>
    pathname.startsWith(SERVER_FN_PREFIX)
      ? `serverFn:${pathname.slice(SERVER_FN_PREFIX.length)}`
      : namePage()(pathname);
}

/**
One request, as the log line records it.
*/
export interface TimingLine {
  readonly kind: "timing";
  readonly route: string;
  readonly method: string;
  readonly status: number;
  readonly ms: number;
}

export interface TimingDeps {
  readonly name: RequestNamer;
  readonly now: () => number;
  readonly log: (line: TimingLine) => void;
}

/**
 * Runs `respond` and logs how long it took. A request that throws is
 * logged as a 500, which is what the platform answers it with, and the
 * error goes on to `server.ts`'s report.
 */
export async function timeRequest(
  request: Request,
  respond: () => Promise<Response>,
  deps: TimingDeps,
): Promise<Response> {
  const started = deps.now();
  const line = (status: number): TimingLine => ({
    kind: "timing",
    route: deps.name(new URL(request.url).pathname),
    method: request.method,
    status,
    ms: deps.now() - started,
  });
  try {
    const response = await respond();
    deps.log(line(response.status));
    return response;
  } catch (error) {
    deps.log(line(500));
    throw error;
  }
}

/**
 * The real clock and log. An object rather than a string: Workers Logs
 * indexes a logged object's fields, which is what the Query Builder groups
 * and charts by.
 */
export function timingDeps(name: RequestNamer): TimingDeps {
  return {
    name,
    now: () => Date.now(),
    log: (line) => {
      console.log(line);
    },
  };
}
