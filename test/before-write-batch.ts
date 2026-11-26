import { vi } from "vitest";

import { env } from "../src/env";
import { isWriteStatement } from "../src/lib/sql/d1-session";

/**
 * Runs `act` just before the next batch that writes reaches D1, then lets
 * that batch run (design 278): the gap between a read that decides a batch
 * and the batch itself, which is where a guard read before the batch goes
 * stale. A batch of reads alone passes untouched, so the code under test
 * can read what it likes first. `act`'s own writes are single statements,
 * never a batch, and so never trigger it. Fires once; the spies stay
 * until the test's `vi.restoreAllMocks()`.
 *
 * D1 hands back a new statement from `bind`, so the query text is
 * recorded on both the prepared statement and every one bound from it:
 * the batch only ever sees bound ones.
 */
export function beforeNextWriteBatch(
  act: () => Promise<unknown>,
  binding: D1Database = env.DIALED_CORE,
): { fired: () => boolean } {
  const queryOf = new WeakMap<D1PreparedStatement, string>();
  const prepare = binding.prepare.bind(binding);
  const batch = binding.batch.bind(binding);
  vi.spyOn(binding, "prepare").mockImplementation((query) => {
    const statement = prepare(query);
    const bind = statement.bind.bind(statement);
    statement.bind = (...values) => {
      const bound = bind(...values);
      queryOf.set(bound, query);
      return bound;
    };
    queryOf.set(statement, query);
    return statement;
  });
  let isFired = false;
  vi.spyOn(binding, "batch").mockImplementation(async (statements) => {
    const isWrites = statements.some((statement) =>
      isWriteStatement(queryOf.get(statement) ?? ""),
    );
    if (isWrites && !isFired) {
      isFired = true;
      await act();
    }
    return batch(statements);
  });
  return { fired: () => isFired };
}
