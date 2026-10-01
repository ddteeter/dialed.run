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
 *
 * The data export (ACC-10) is wired the same way twice over: its sweep to
 * the hourly firing, and its consumers to `dialed-exports` (decision D-86).
 */
describe("the Worker entry hands the firings and the queue their upkeep", () => {
  it("passes account deletion's purge and the export sweep to handleScheduled", () => {
    const code = withoutComments(serverSource);
    expect(code).toContain(
      'import { purgeDueAccounts } from "./modules/account/purge";',
    );
    expect(code).toContain(
      'import { sweepExports } from "./modules/account/export-sweep";',
    );
    expect(code).toMatch(
      /handleScheduled\(controller, undefined, \{\s*purgeAccounts: purgeDueAccounts,\s*sweepExports,\s*\}\)/u,
    );
  });

  it("passes the export's consumers to handleQueueBatch", () => {
    const code = withoutComments(serverSource);
    expect(code).toContain(
      'import { exportConsumersFromEnv } from "./modules/account/export-build";',
    );
    expect(code).toContain("handleQueueBatch(batch, exportConsumersFromEnv())");
  });
});
