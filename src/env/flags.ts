/**
 * Build flags: Vite's `import.meta.env.VITE_*`, replaced at build time in
 * the Worker's code as well as the client's. Not bindings, and not in
 * `wrangler.jsonc`.
 */

/**
 * Whether each request counts its D1 statements and rows read and says so
 * in a response header (design 182, part 2). `playwright.config.ts`'s dev
 * server sets `VITE_D1_QUERY_TALLY=1`; a production build, made without
 * it, folds this to `false`, and the counter away with it.
 */
export function isQueryTallyEnabled(): boolean {
  return import.meta.env.VITE_D1_QUERY_TALLY === "1";
}
