import type { drizzle } from "drizzle-orm/d1";

import { primaryCoreDb, waitUntil } from "../../env";
import { captureException } from "../ops";
import {
  deviceBookmarkCookie,
  deviceBookmarkFrom,
  runInD1Scope,
  scopeOutcome,
} from "../../lib/sql/d1-session";
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
}

export function d1RequestDepsFromEnv(): D1RequestDeps {
  return { db: primaryCoreDb(), defer: waitUntil, capture: captureException };
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

/**
 * One request as one D1 scope (design 143): its reads share a session
 * started from the device's bookmark, the device gets back the newest
 * bookmark the request reached, and a signed-in runner who wrote has it
 * stored, after the response, for their other devices.
 *
 * The cookie is only sent when the bookmark moved, so a request that read
 * nothing, or read nothing newer, adds no header.
 */
export async function respondInD1Scope(
  request: Request,
  handle: () => Response | Promise<Response>,
  deps: D1RequestDeps,
): Promise<Response> {
  const device = deviceBookmarkFrom(request.headers.get("cookie"));
  return runInD1Scope(device, async () => {
    const response = await handle();
    const { bookmark, writerId } = scopeOutcome();
    // Never older than the device's own bookmark, so "unchanged" is the
    // only way it can be absent.
    const moved = bookmark === device ? undefined : bookmark;
    if (moved === undefined) return response;
    if (writerId !== undefined) {
      // Degrade, don't fail (law 5): a lost store costs the runner's other
      // devices one stale read, so it is reported and nothing more.
      deps.defer(storeReported(deps, writerId, moved));
    }
    const sent = new Response(response.body, response);
    sent.headers.append("set-cookie", deviceBookmarkCookie(moved));
    return sent;
  });
}
