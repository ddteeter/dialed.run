import { describe, expect, it } from "vitest";

import serverSource from "../../src/server.ts?raw";
import { withoutComments } from "./source-text";

/**
 * Account deletion's purge (task 126, ACC-9) reaches the daily firing only
 * through the Worker entry: `ops` cannot import it without a cycle, so
 * `handleScheduled` takes it as upkeep, and `src/server.ts` is the one
 * place that hands it over. That file cannot be imported by a test — it
 * pulls TanStack Start's server entry — so the wiring is read from its
 * source, as `routes-stamp-hydration` reads routes. Without this, a purge
 * nobody passes in never runs, and every test of it still passes.
 */
describe("the Worker entry hands the daily firing its upkeep", () => {
  it("passes account deletion's purge to handleScheduled", () => {
    const code = withoutComments(serverSource);
    expect(code).toContain(
      'import { purgeDueAccounts } from "./modules/account/purge";',
    );
    expect(code).toMatch(
      /handleScheduled\(controller, undefined, \{\s*purgeAccounts: purgeDueAccounts,\s*\}\)/u,
    );
  });
});
