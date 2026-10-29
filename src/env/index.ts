/**
 * The ONLY module that touches Workers bindings (CLAUDE.md architecture
 * rules; enforced by dependency-cruiser). Everything else imports `env`
 * from here.
 *
 * `waitUntil` rides along because it is the same kind of thing: a
 * platform primitive from `cloudflare:workers`, which nothing else may
 * import. `ops/sentry.ts` hands it to Toucan so a report outlives the
 * invocation that made it (audit finding 0.4).
 *
 * `cache` is the third: the Worker's own edge cache (Workers Caching,
 * design 161), which `ops/edge-purge.ts` purges by tag. Where the runtime
 * has no Workers Caching (vitest's workerd, `vite dev`) it is still
 * exported, but has no `purge`; the purge checks rather than trusts it.
 */

export { cache, env, waitUntil } from "cloudflare:workers";
export { coreDb, primaryCoreDb, weatherDb } from "./d1";
