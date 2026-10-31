/**
 * Purging the open web's pages from the edge by tag (design 163, D-153):
 * what a write that takes a page back calls, so the page goes within the
 * purge rather than the TTL.
 *
 * **An accelerator, never the guarantee.** The 60-second TTL
 * (`./public-cache.ts`) bounds how long a retracted page can stay up
 * whatever happens here. Workers Caching rate-limits purges at the Free
 * tier's limits (5 calls a minute, a bucket of 25) whatever the plan, so a
 * burst of retractions can be refused; one call carries all of a
 * retraction's tags, and a ban or a leaving names the runner, not each
 * kit.
 *
 * **Never fails or delays the write** (law 5). The purge runs in
 * `waitUntil`, after the write's own batch, and a refusal or a throw is
 * reported to Sentry (law 7) with the tags it named (ids and a handle,
 * never a body) and nothing else happens.
 *
 * **Degrades where there is no cache.** The runtime exports `cache` with
 * no `purge` when Workers Caching is not on, as under vitest's workerd and
 * `vite dev`; then there is nothing to purge and the call does nothing.
 */
import { cache, waitUntil } from "../../env";
import {
  scopeOfTags,
  type PurgeTags,
  type TaggedScope,
} from "../../lib/cache-tags";

import { syncPublicPhotosLater } from "./public-photos";
import { captureException, type KeepAlive } from "./sentry";

/**
 * The part of the Worker's cache a purge uses. `purge` is optional because
 * the runtime may not have one (above).
 */
export interface EdgeCache {
  readonly purge?: CacheContext["purge"];
}

/**
What a purge needs from the platform, handed in so a test can watch it.
*/
export interface PurgeDeps {
  readonly edge: EdgeCache;
  readonly keepAlive: KeepAlive;
  readonly report: (error: unknown, context: Record<string, string>) => void;
}

/**
 * Purges `tags` from `deps.edge` in the background, once each. Nothing to
 * name, or no cache to purge, does nothing.
 */
export function purgeTags(deps: PurgeDeps, tags: readonly string[]): void {
  const { edge } = deps;
  const unique = [...new Set(tags)];
  if (unique.length === 0 || typeof edge.purge !== "function") return;
  const purge = edge.purge.bind(edge);
  deps.keepAlive(settle(() => purge({ tags: unique }), unique, deps.report));
}

/**
 * The purge, settled: a refusal (a rate limit, say) or a throw is
 * reported, and the promise always resolves. `run` is called inside the
 * `try`, so a purge that throws before it returns a promise is caught too.
 */
async function settle(
  run: () => Promise<CachePurgeResult>,
  tags: readonly string[],
  report: PurgeDeps["report"],
): Promise<void> {
  const context = { tags: tags.join(",") };
  try {
    const result = await run();
    if (result.success) return;
    report(new Error("edge purge refused"), {
      ...context,
      errors: result.errors
        .map((error) => `${String(error.code)} ${error.message}`)
        .join("; "),
    });
  } catch (error: unknown) {
    report(error, context);
  }
}

/**
 * What the Worker's purges run on: its own cache, kept alive past the
 * response, refusals to Sentry. References only, so nothing is built when
 * this module loads.
 */
const workerPurge: PurgeDeps = {
  edge: cache,
  keepAlive: waitUntil,
  report: captureException,
};

/**
 * The purge every writer uses: `purgeTags` on the Worker's own cache, and
 * the public photo reconcile for the kits and runners the tags name
 * (design 163 step 8), so whatever takes a page back takes its photos'
 * copies back too — and a kit made PUBLIC gets its copies. Both in the
 * background; neither can fail the write.
 */
export function purgeAndSync(
  deps: PurgeDeps,
  sync: (scope: TaggedScope) => void,
  tags: readonly string[],
): void {
  purgeTags(deps, tags);
  sync(scopeOfTags(tags));
}

/**
 * `purgeAndSync` on the Worker's own cache and buckets. Bound rather
 * than wrapped, as the purge was before it.
 */
export const purgePublicPages: PurgeTags = purgeAndSync.bind(
  undefined,
  workerPurge,
  syncPublicPhotosLater,
);
