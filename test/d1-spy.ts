import { vi } from "vitest";

import { env } from "../src/env";
import { isWriteStatement } from "../src/lib/sql/d1-session";

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

/**
 * What a piece of work asked one D1 database (design 182): every statement
 * that ran, a statement inside a batch counting once each, and the rows D1
 * says it read.
 */
export interface QueryTally {
  /**
  The SQL of each statement run, in order: the count is its length.
  */
  readonly statements: string[];
  /**
  The sum of `meta.rows_read` over every statement run.
  */
  rowsRead: number;
}

/**
 * Run `work` and count what it asks `binding`, bare or through a session.
 *
 * `run()`, `all()` and `batch()` hand back `meta.rows_read`; `raw()` and
 * `first()` carry no meta, and drizzle reads every query with fields
 * through `raw()`. So for a read through either, the counter runs the same
 * statement once more with `all()` for its meta, uncounted. A select
 * cannot change anything, so the second run changes nothing but the
 * count; a write read through `raw()` (`.returning()`) adds no rows read,
 * since running it twice would write twice.
 */
export async function queriesDuring(
  work: () => Promise<unknown>,
  binding: D1Database = env.DIALED_CORE,
): Promise<QueryTally> {
  const tally: QueryTally = { statements: [], rowsRead: 0 };
  const prepare = binding.prepare.bind(binding);
  const batch: D1Database["batch"] = binding.batch.bind(binding);
  const withSession = binding.withSession.bind(binding);
  const spies = [
    vi
      .spyOn(binding, "prepare")
      .mockImplementation((query) => counted(prepare(query), query, tally)),
    vi
      .spyOn(binding, "batch")
      .mockImplementation(<T>(statements: D1PreparedStatement[]) =>
        batchCounted((real) => batch<T>(real), statements, tally),
      ),
    vi
      .spyOn(binding, "withSession")
      .mockImplementation((constraint) => {
        const session = withSession(constraint);
        return {
          prepare: (query) => counted(session.prepare(query), query, tally),
          batch: <T>(statements: D1PreparedStatement[]) =>
            batchCounted((real) => session.batch<T>(real), statements, tally),
          getBookmark: () => session.getBookmark(),
        };
      }),
  ];
  try {
    await work();
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
  return tally;
}

/**
The statement a counted one stands for, so a batch runs the real one.
*/
const realOf = new WeakMap<D1PreparedStatement, D1PreparedStatement>();

async function batchCounted<T>(
  batch: (statements: D1PreparedStatement[]) => Promise<D1Result<T>[]>,
  statements: D1PreparedStatement[],
  tally: QueryTally,
): Promise<D1Result<T>[]> {
  const results = await batch(
    statements.map((statement) => realOf.get(statement) ?? statement),
  );
  for (const result of results) {
    tally.statements.push("batch");
    tally.rowsRead += result.meta.rows_read;
  }
  return results;
}

/**
 * A statement that counts itself into `tally` each time it runs. A Proxy
 * rather than a class: `raw` and `first` are overloaded generics no class
 * can restate, and every other member must still be the real one.
 */
function counted(
  real: D1PreparedStatement,
  sql: string,
  tally: QueryTally,
): D1PreparedStatement {
  const proxy = new Proxy(real, {
    get(target, property) {
      switch (property) {
        case "bind": {
          return (...values: unknown[]) =>
            counted(target.bind(...values), sql, tally);
        }
        case "run":
        case "all": {
          return async () => {
            const result = await target[property]();
            tally.statements.push(sql);
            tally.rowsRead += result.meta.rows_read;
            return result;
          };
        }
        case "raw":
        case "first": {
          return async (...args: unknown[]) => {
            const method = target[property].bind(target);
            const result: unknown = await Reflect.apply(method, target, args);
            tally.statements.push(sql);
            if (!isWriteStatement(sql)) {
              const metered = await target.all();
              tally.rowsRead += metered.meta.rows_read;
            }
            return result;
          };
        }
        default: {
          const value: unknown = Reflect.get(target, property, target);
          const member: unknown =
            typeof value === "function" ? value.bind(target) : value;
          return member;
        }
      }
    },
  });
  realOf.set(proxy, real);
  return proxy;
}
