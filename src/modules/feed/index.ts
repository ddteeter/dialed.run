/**
 * The feed module's public API.
 *
 * Created by lane 105, which needed one: task 105's requirement 5 says the
 * Call teaser "reads entry/verdict data via the feed module's public API",
 * and `modules/feed` was the only module without a barrel — so there was
 * nothing to read it through, and dependency-cruiser's index-only rule
 * means a deep import is not an option.
 *
 * Deliberately narrow. The feed's own routes import its internals
 * directly, as they always have, and a barrel that re-exported everything
 * would invite other lanes to reach into surfaces the feed lane has not
 * agreed to keep stable. Widen it when a second consumer has a second
 * need — which task 115 is: DS2's table is
 * `modules/runs/components/VerdictBacklog` (the packet's ownership) and
 * its rows are outfit entries (this module's). The four below are
 * **types only**, so nothing server-side crosses: `backlog.ts` reaches
 * `src/env`, and a value export from here would put `cloudflare:workers`
 * in the client bundle of every route that touches the barrel.
 *
 * Server-fn glue stays in ./functions (imported directly by routes), so
 * this barrel remains loadable in the vitest workers pool — the same split
 * `modules/auth` and `modules/closet` make.
 */
export type { CoverageBand } from "./coverage";
export { coverageLadder } from "./ladder-read";
export type { Backlog, BacklogRow, BacklogSuggestion } from "./backlog";
export type { Conditions } from "./conditions-shape";
