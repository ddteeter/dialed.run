import type { drizzle } from "drizzle-orm/d1";

import { primaryCoreDb, isQueryTallyEnabled, waitUntil } from "../../env";
import { captureException } from "../ops";
import {
  deviceBookmarkCookie,
  deviceBookmarkFrom,
  runInD1Scope,
  scopeOutcome,
} from "../../lib/sql/d1-session";
import { formatQueryHeader, QUERY_HEADER } from "../../lib/query-report";
import { storeRunnerBookmark } from "./d1-bookmark";

type Db = ReturnType<typeof drizzle>;

export interface D1RequestDeps {
  readonly db: Db;
  /**
  Work that outlives the response: `waitUntil`.
  */
  readonly defer: (work: Promise<void>) => void;
  /**
  Where a failed store goes (law 7): it never fails the response.
  */
  readonly capture: (error: unknown, context: Record<string, string>) => void;
  /**
   * Names a request whose D1 work goes back in the `x-d1-queries` header
   * (design 182, part 2); none, and nothing is counted.
   */
  readonly nameQueries: ((pathname: string) => string) | undefined;
}

/**
 * `name` is design 165's request namer, the one `server.ts` times by, so
 * the query report and the timing log call a request the same thing.
 */
export function d1RequestDepsFromEnv(
  name: (pathname: string) => string,
): D1RequestDeps {
  return {
    db: primaryCoreDb(),
    defer: waitUntil,
    capture: captureException,
    nameQueries: isQueryTallyEnabled() ? name : undefined,
  };
}

async function storeReported(
  deps: D1RequestDeps,
  userId: string,
  bookmark: string,
): Promise<void> {
  try {
    await storeRunnerBookmark(deps.db, userId, bookmark);
  } catch (error) {
    deps.capture(error, { userId, job: "d1-bookmark-store" });
  }
}

const BOOKMARK_ORDER_MESSAGE =
  "a D1 session ended at a bookmark sorting before the one it started from";

/**
 * One request as one D1 scope (design 143): its reads share a session
 * started from the device's bookmark, the device gets back the newest
 * bookmark the request reached, and a signed-in runner who wrote has it
 * stored, after the response, for their other devices.
 *
 * The cookie is only sent when the bookmark moved, so a request that read
 * nothing, or read nothing newer, adds no header.
 *
 * A tallied request also says what it asked D1, under its route's name.
 * The count stops when the `Response` exists, where design 165's `ms`
 * stops: a streamed page's deferred data is not in it.
 */
export async function respondInD1Scope(
  request: Request,
  handle: () => Response | Promise<Response>,
  deps: D1RequestDeps,
): Promise<Response> {
  const device = deviceBookmarkFrom(request.headers.get("cookie"));
  const tallyAs = deps.nameQueries?.(new URL(request.url).pathname);
  const work = async () => {
    const response = await handle();
    const { bookmark, writerId, backwards, queries } = scopeOutcome();
    if (backwards !== undefined) {
      // D1 documents bookmarks as sorting oldest to newest, and every
      // choice this module makes rests on it; this is the alarm if not.
      deps.capture(new Error(BOOKMARK_ORDER_MESSAGE), {
        job: "d1-bookmark-order",
        ...backwards,
      });
    }
    // Never older than the device's own bookmark, so "unchanged" is the
    // only way it can be absent.
    const moved = bookmark === device ? undefined : bookmark;
    const added: [string, string][] = [];
    if (moved !== undefined) {
      if (writerId !== undefined) {
        // Degrade, don't fail (law 5): a lost store costs the runner's
        // other devices one stale read, so it is reported and nothing more.
        deps.defer(storeReported(deps, writerId, moved));
      }
      added.push(["set-cookie", deviceBookmarkCookie(moved)]);
    }
    if (queries !== undefined) {
      added.push([QUERY_HEADER, formatQueryHeader(queries)]);
    }
    if (added.length === 0) return response;
    const sent = new Response(response.body, response);
    for (const [name, value] of added) sent.headers.append(name, value);
    return sent;
  };
  return runInD1Scope(device, work, { tallyAs });
}
