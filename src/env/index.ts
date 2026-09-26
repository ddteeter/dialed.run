/**
 * The ONLY module that touches Workers bindings (CLAUDE.md architecture
 * rules; enforced by dependency-cruiser). Everything else imports `env`
 * from here.
 *
 * `waitUntil` rides along because it is the same kind of thing: a
 * platform primitive from `cloudflare:workers`, which nothing else may
 * import. `ops/sentry.ts` hands it to Toucan so a report outlives the
 * invocation that made it (audit finding 0.4).
 */

export { env, waitUntil } from "cloudflare:workers";
