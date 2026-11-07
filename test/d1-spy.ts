import { vi } from "vitest";

import { env } from "../src/env";
import type { OnRun } from "../src/lib/sql/counted-statement";
import {
  countedBatch,
  countedStatement,
} from "../src/lib/sql/counted-statement";
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
 * Run `work` and count what it asks `binding`, bare or through a session,
 * with the counter a tallied request uses (`counted-statement.ts`, which
 * says how a `raw()` or `first()` read is metered).
 */
export async function queriesDuring(
  work: () => Promise<unknown>,
  binding: D1Database = env.DIALED_CORE,
): Promise<QueryTally> {
  const tally: QueryTally = { statements: [], rowsRead: 0 };
  const into =
    (sql: string): OnRun =>
    (rowsRead) => {
      tally.statements.push(sql);
      tally.rowsRead += rowsRead;
    };
  const counted = (real: D1PreparedStatement, sql: string) =>
    countedStatement(real, !isWriteStatement(sql), into(sql));
  const prepare = binding.prepare.bind(binding);
  const batch: D1Database["batch"] = binding.batch.bind(binding);
  const withSession = binding.withSession.bind(binding);
  const spies = [
    vi
      .spyOn(binding, "prepare")
      .mockImplementation((query) => counted(prepare(query), query)),
    vi
      .spyOn(binding, "batch")
      .mockImplementation(<T>(statements: D1PreparedStatement[]) =>
        countedBatch(batch<T>(statements), into("batch")),
      ),
    vi.spyOn(binding, "withSession").mockImplementation((constraint) => {
      const session = withSession(constraint);
      return {
        prepare: (query) => counted(session.prepare(query), query),
        batch: <T>(statements: D1PreparedStatement[]) =>
          countedBatch(session.batch<T>(statements), into("batch")),
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
 * What `work` asked core and weather, the two databases a list read can
 * touch (design 182). A scaling test compares two of these.
 */
export interface QueryCounts {
  readonly core: number;
  readonly weather: number;
  readonly coreRowsRead: number;
  readonly weatherRowsRead: number;
}

export async function queryCounts(
  work: () => Promise<unknown>,
): Promise<QueryCounts> {
  let core: QueryTally | undefined;
  const weather = await queriesDuring(async () => {
    core = await queriesDuring(work, env.DIALED_CORE);
  }, env.DIALED_WEATHER);
  const counted = core ?? { statements: [], rowsRead: 0 };
  return {
    core: counted.statements.length,
    weather: weather.statements.length,
    coreRowsRead: counted.rowsRead,
    weatherRowsRead: weather.rowsRead,
  };
}
