import { describe, expect, it } from "vitest";

import queuesSource from "../../src/modules/dispatch/queues.ts?raw";
import scheduledSource from "../../src/modules/dispatch/scheduled.ts?raw";
import serverSource from "../../src/server.ts?raw";
import { withoutComments } from "./source-text";

/**
 * The firings' jobs from other modules are the dispatch's own imports
 * (design 253): account deletion's purge (task 126, ACC-9), the data
 * export's sweep (ACC-10), the handle re-ask (task 126 PR B), the product
 * link a confirmation owes (design 133), the auth rows' and the answered
 * access requests' sweeps, and the copyright holds' (D-130).
 * `handleScheduled` spreads what a test hands it over them, so every test
 * of a firing can replace one. What no test of a firing can see is the
 * wiring of the real ones, so it is read from the source here. Without it,
 * a job dropped from `liveUpkeep` never runs, and every test that hands in
 * a fake still passes.
 *
 * `src/server.ts` cannot be imported by a test (it pulls TanStack Start's
 * server entry), so it is read the same way: it hands in only the two speed
 * checks, which read the route names this tree could have written.
 */
describe("the firings and the queue get their jobs from the dispatch", () => {
  it("imports each module's job through its door and runs it unless a test replaces it", () => {
    const code = withoutComments(scheduledSource);
    for (const line of [
      'import { forgetAnsweredRequests } from "../account/access";',
      'import { sweepExports } from "../account/export-build";',
      'import { rescreenHandlesFromEnv } from "../account/handles";',
      'import { purgeDueAccounts } from "../account/purge";',
      'import { sweepExpiredAuthRows, sweepExpiredStates } from "../auth/expired-rows";',
      'import { linkTypedGarments } from "../closet";',
      'import { sweepCopyrightHolds } from "../feed/moderation";',
    ]) {
      expect(code).toContain(line);
    }
    expect(code).toMatch(
      /const liveUpkeep: Upkeep = \{\s*purgeAccounts: purgeDueAccounts,\s*sweepExports,\s*rescreenHandles: rescreenHandlesFromEnv,\s*linkProducts: linkTypedGarments,\s*sweepAuthRows: sweepExpiredAuthRows,\s*forgetAnsweredRequests,\s*sweepCopyrightHolds,\s*\};/u,
    );
    expect(code).toContain(
      "const upkeep: Upkeep = { ...liveUpkeep, ...handedIn };",
    );
  });

  it("runs the export's consumers unless a test hands in its own", () => {
    const code = withoutComments(queuesSource);
    expect(code).toMatch(
      /import \{\s*exportConsumersFromEnv,\s*type ExportConsumers,\s*\} from "\.\.\/account\/export-build";/u,
    );
    expect(code).toContain(
      "await (exports ?? exportConsumersFromEnv()).batch(batch);",
    );
    expect(code).toContain(
      "await (exports ?? exportConsumersFromEnv()).deadLetters(batch);",
    );
  });

  it("has the Worker entry hand in the speed checks and nothing else", () => {
    const code = withoutComments(serverSource);
    // The speed checks (design 165): `ops`'s own, handed in because they
    // judge only the route names this tree has (SA-M34).
    expect(code).toMatch(
      /import \{[^}]*\bdailySpeed,\s*hourlySpeed,[^}]*\} from "\.\/modules\/ops\/speed";/u,
    );
    expect(code).toMatch(
      /handleScheduled\(controller, undefined, \{\s*speed: \(today, anomalies\) =>\s*dailySpeed\(today, anomalies, speedDigestDepsFromEnv\(isKnownRoute\)\),\s*speedHourly: \(now, report\) =>\s*hourlySpeed\(now, report, hourlySpeedDepsFromEnv\(isKnownRoute\)\),\s*\}\)/u,
    );
    expect(code).toContain(
      "const isKnownRoute = knownRoutes(() => createRouter({ routeTree }));",
    );
    expect(code).toContain("await handleQueueBatch(batch);");
  });
});
