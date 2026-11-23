/**
 * Server timing (design 165, part 2): one structured log line per request,
 * named by route id, so Workers Logs' Query Builder can chart p50/p95 per
 * screen with no binding of its own.
 *
 * `ms` runs until the `Response` exists, which for a streamed SSR page is
 * its time to first byte; the invocation's own wall time, which Workers
 * Logs records beside this line, covers the rest of the body.
 */
import { SERVER_FN_ROUTE } from "../../../lib/query-report";

import { serverFnIdOf } from "../edge";
import { captureException } from "../sentry";
import { recordServerTiming } from "./vitals";
import { knownRouteClause, UNMATCHED } from "./vitals-queries";

/**
 * What a request is called in the log. A server function goes by its id,
 * which in production is a stable hash of its file and name; anything no
 * route matches is `unmatched`, so a scanner's thousand paths are one
 * value rather than a thousand.
 */
export type RequestNamer = (url: URL) => string;

const FAILED_SERVER_FN = `${SERVER_FN_ROUTE}failed`;

/**
 * The name a timing line records: a server function that did not answer
 * `2xx` is `serverFn:failed`, since an id nobody registered answers 500 and
 * would otherwise mint a name per request (SA-L08). The speed checks judge
 * only `2xx` server rows, so nothing they read is lost.
 */
export function timedName(name: string, status: number): string {
  const isAnswered = status >= 200 && status < 300;
  return !isAnswered && name.startsWith(SERVER_FN_ROUTE)
    ? FAILED_SERVER_FN
    : name;
}

/**
 * The one thing the namer asks of TanStack's router: the route a pathname
 * ends on (`foundRoute`, the third of `getMatchedRoutes`' answer), matched
 * by the router itself rather than a copy of its rules.
 */
export interface RouteFinder {
  getMatchedRoutes(
    pathname: string,
  ): readonly [unknown, unknown, { readonly id: string } | undefined];
  /**
  Every route the tree holds, by id.
  */
  readonly routesById: object;
}

/**
 * Whether a route name in the speed data is one this Worker could have
 * written: a route of the tree, a server function's name, or `unmatched`.
 * A beacon names its route itself, so the speed checks and the rollup keep
 * only these (SA-M34).
 *
 * `sqlFilter` is the same rule as lines of a query's `WHERE`, so a query
 * filters before its cut and rows of names nobody wrote cannot crowd the
 * real ones out of it. No lines when every name is kept.
 */
export interface RouteKnown {
  (route: string): boolean;
  readonly sqlFilter: () => readonly string[];
}

/**
Every route name kept, with no filter: what `knownRoutes` falls back to.
*/
export const isAnyRoute: RouteKnown = Object.assign(() => true, {
  sqlFilter: () => [],
});

/**
 * `RouteKnown` over the router `makeRouter` builds, on the first question.
 * A router that will not build is reported and every name is kept, as
 * before this check (law 5).
 */
export function knownRoutes(
  makeRouter: () => RouteFinder,
  report: (error: unknown) => void = (error) => {
    captureException(error, { surface: "timing" });
  },
): RouteKnown {
  let tree: object | undefined;
  let isBuilt = false;
  const routesById = (): object | undefined => {
    if (!isBuilt) {
      isBuilt = true;
      try {
        tree = makeRouter().routesById;
      } catch (error) {
        report(error);
      }
    }
    return tree;
  };
  const isKnown = (name: string): boolean => {
    const ids = routesById();
    return (
      ids === undefined ||
      name === UNMATCHED ||
      name.startsWith(SERVER_FN_ROUTE) ||
      Object.hasOwn(ids, name)
    );
  };
  return Object.assign(isKnown, {
    sqlFilter: () => {
      const ids = routesById();
      return ids === undefined ? [] : knownRouteClause(Object.keys(ids));
    },
  });
}

/**
 * A namer over the router `makeRouter` builds. Nothing is built until the
 * first request asks, so `server.ts` can hold one at module scope; a
 * router that will not build is reported once and every page is named
 * `unmatched` (law 5): naming must never stop the Worker answering.
 */
export function requestNamer(
  makeRouter: () => RouteFinder,
  report: (error: unknown) => void = (error) => {
    captureException(error, { surface: "timing" });
  },
): RequestNamer {
  let pageName: ((pathname: string) => string) | undefined;
  const namePage = (): ((pathname: string) => string) => {
    if (pageName !== undefined) return pageName;
    try {
      const router = makeRouter();
      pageName = (pathname) =>
        router.getMatchedRoutes(pathname)[2]?.id ?? UNMATCHED;
    } catch (error) {
      report(error);
      pageName = () => UNMATCHED;
    }
    return pageName;
  };
  // A server function is named by the id TanStack Start calls: the first
  // segment after the prefix of the decoded path (`serverFnIdOf`), so any
  // spelling of one id, and anything after it, is that id's name.
  return (url) => {
    const id = serverFnIdOf(url);
    return id === undefined
      ? namePage()(url.pathname)
      : `${SERVER_FN_ROUTE}${id}`;
  };
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
  /**
   * Keeps the line past Workers Logs' 7 days, in Analytics Engine. Never
   * throws (`recordServerTiming`).
   */
  readonly record: (line: TimingLine) => void;
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
  const finish = (status: number): void => {
    const line: TimingLine = {
      kind: "timing",
      route: timedName(deps.name(new URL(request.url)), status),
      method: request.method,
      status,
      ms: deps.now() - started,
    };
    deps.log(line);
    deps.record(line);
  };
  try {
    const response = await respond();
    finish(response.status);
    return response;
  } catch (error) {
    finish(500);
    throw error;
  }
}

/**
 * The real clock, log and dataset. An object rather than a string: Workers Logs
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
    record: (line) => {
      recordServerTiming(line);
    },
  };
}
