/**
 * How often one statement is tried against a locked database, and how long
 * it waits before the next try (multiplied by the attempt): about two
 * seconds in all before the lock is reported.
 */
const BUSY_ATTEMPTS = 5;
const BUSY_BACKOFF_MS = 200;

/**
 * The two ways a locked local D1 reaches this process. SQLite's own words,
 * when they survive the trip; and workerd's masked form, which is what it
 * usually sends instead: the SQLite error is logged to the proxy's stderr
 * ("database is locked: SQLITE_BUSY … wdErrId = <ref>") and the caller gets
 * only `internal error; reference = <ref>`, sometimes behind D1's "Failed
 * to get session commit token: ". Every masked error seen from this proxy
 * on CI (runs 38054389037, 39173780977, 40132692494, 41218872437) was that
 * lock, and the stderr line with the matching reference said so.
 */
const LOCKED =
  /SQLITE_BUSY|database is locked|(?:(?:^|: )internal error; reference = \w+$)/u;

/**
 * Whether `error`, or anything in its `cause` chain, is the database being
 * locked. Drizzle wraps the driver's error ("Failed query: …") and keeps
 * the original as its cause, and D1 wraps workerd's the same way.
 */
export function isLocked(error: unknown): boolean {
  for (let current = error; current instanceof Error; current = current.cause) {
    if (LOCKED.test(current.message)) return true;
  }
  return false;
}

/**
 * Runs one D1 statement, trying it again while the database is locked.
 *
 * The server under test writes to the same local D1 file this process
 * seeds and reads, and a write it is still finishing (a notification it
 * records when a page opens, a session it touches) can hold SQLite's lock
 * at the moment a spec's statement runs. `workers: 1` in
 * playwright.config.ts keeps specs from contending with each other; it
 * cannot keep the server from contending with the spec.
 *
 * Retrying is safe because it is one statement: D1 runs each one (and each
 * batch) in its own transaction, so a statement that lost the lock
 * committed nothing. Retrying a whole `withLocalDb` callback would not be:
 * the statements before the locked one have committed, and running them
 * again fails on their own primary keys.
 *
 * A bounded retry is fine here: this is test support, not a request
 * handler, and law 3's "no retry loops" is about the app. Anything that is
 * not the lock, or a lock that outlasts the last attempt, still fails, with
 * the original error.
 */
export async function whileLocked<T>(statement: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await statement();
    } catch (error) {
      if (attempt >= BUSY_ATTEMPTS || !isLocked(error)) throw error;
      await new Promise((resolve) => {
        setTimeout(resolve, BUSY_BACKOFF_MS * attempt);
      });
    }
  }
}

/**
 * A prepared statement whose every execution goes through `whileLocked`.
 * Drizzle's D1 driver reaches the database only through `prepare`, `bind`,
 * `run`, `all`, `raw` and `batch`, so wrapping the binding retries every
 * query a spec writes without the spec knowing.
 */
class LockRetryingStatement implements D1PreparedStatement {
  constructor(readonly inner: D1PreparedStatement) {}

  bind(...values: unknown[]): D1PreparedStatement {
    return new LockRetryingStatement(this.inner.bind(...values));
  }

  first<T = unknown>(colName?: string): Promise<T | null> {
    return whileLocked(() =>
      colName === undefined
        ? this.inner.first<T>()
        : this.inner.first<T>(colName),
    );
  }

  run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return whileLocked(() => this.inner.run<T>());
  }

  all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return whileLocked(() => this.inner.all<T>());
  }

  raw<T = unknown[]>(options: {
    columnNames: true;
  }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  raw<T = unknown[]>(options?: {
    columnNames?: boolean;
  }): Promise<[string[], ...T[]] | T[]> {
    return whileLocked<[string[], ...T[]] | T[]>(() =>
      options?.columnNames === true
        ? this.inner.raw<T>({ columnNames: true })
        : this.inner.raw<T>(),
    );
  }
}

/**
 * The binding's own statement for one of ours: the binding's `batch` reads
 * its statements' internals, so it must be handed the originals.
 */
function unwrapped(statement: D1PreparedStatement): D1PreparedStatement {
  return statement instanceof LockRetryingStatement
    ? statement.inner
    : statement;
}

/**
A D1 binding whose every statement and batch retries while locked.
*/
export class LockRetryingDatabase implements D1Database {
  constructor(private readonly inner: D1Database) {}

  prepare(query: string): D1PreparedStatement {
    return new LockRetryingStatement(this.inner.prepare(query));
  }

  batch<T = unknown>(
    statements: D1PreparedStatement[],
  ): Promise<D1Result<T>[]> {
    const originals = statements.map((statement) => unwrapped(statement));
    return whileLocked(() => this.inner.batch<T>(originals));
  }

  exec(query: string): Promise<D1ExecResult> {
    return whileLocked(() => this.inner.exec(query));
  }

  /**
   * Neither is reached by drizzle or by any spec, and a session would be a
   * way around the retry, so both refuse rather than forward.
   */
  withSession(): D1DatabaseSession {
    throw new Error("withLocalDb does not open D1 sessions");
  }

  dump(): Promise<ArrayBuffer> {
    return Promise.reject(new Error("withLocalDb does not dump databases"));
  }
}
