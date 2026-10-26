import { env } from "../src/env";

/**
 * The real local D1 under a binding that records what it is asked: every
 * `withSession` constraint, and every query that reached the bare binding
 * instead of a session (design 143). Locally there are no replicas, so
 * what a test can pin is the decision, not the lag. `reporting`, when
 * given, is the bookmark every session claims to have reached.
 */
export function spiedBinding(
  real: D1Database = env.DIALED_CORE,
  reporting?: string,
) {
  const binding = new SpiedBinding(real, reporting);
  return { binding, opened: binding.opened, bare: binding.bare };
}

// A class, not an object literal: D1Database still requires the deprecated
// `dump`, and only a class method implements it without reading as a use.
class SpiedBinding implements D1Database {
  readonly opened: string[] = [];
  readonly bare: string[] = [];

  constructor(
    private readonly real: D1Database,
    private readonly reporting: string | undefined,
  ) {}

  prepare(query: string): D1PreparedStatement {
    this.bare.push(query);
    return this.real.prepare(query);
  }

  batch<T = unknown>(
    statements: D1PreparedStatement[],
  ): Promise<D1Result<T>[]> {
    this.bare.push("batch");
    return this.real.batch<T>(statements);
  }

  exec(query: string): Promise<D1ExecResult> {
    return this.real.exec(query);
  }

  dump(): Promise<ArrayBuffer> {
    return Promise.reject(new Error("not used"));
  }

  withSession(
    constraint?: Parameters<D1Database["withSession"]>[0],
  ): D1DatabaseSession {
    this.opened.push(String(constraint));
    const session = this.real.withSession(constraint);
    const { reporting } = this;
    if (reporting === undefined) return session;
    // D1 breaking its own ordering, on demand: every session reports
    // `reporting` as its bookmark, whatever it was opened from.
    return {
      prepare: (query) => session.prepare(query),
      batch: (statements) => session.batch(statements),
      getBookmark: () => reporting,
    };
  }
}
