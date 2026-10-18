import { env } from "../src/env";

/**
 * The real local D1 under a binding that records what it is asked: every
 * `withSession` constraint, and every query that reached the bare binding
 * instead of a session (design 143). Locally there are no replicas, so
 * what a test can pin is the decision, not the lag.
 */
export function spiedBinding(real: D1Database = env.DIALED_CORE) {
  const opened: string[] = [];
  const bare: string[] = [];
  const binding: D1Database = {
    prepare(query) {
      bare.push(query);
      return real.prepare(query);
    },
    batch(statements) {
      bare.push("batch");
      return real.batch(statements);
    },
    exec: (query) => real.exec(query),
    dump: () => Promise.reject(new Error("not used")),
    withSession(constraint) {
      opened.push(String(constraint));
      return real.withSession(constraint);
    },
  };
  return { binding, opened, bare };
}
