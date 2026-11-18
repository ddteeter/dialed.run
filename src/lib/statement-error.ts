/**
 * A failed D1 statement's error without its bound values (SA-L08).
 *
 * drizzle wraps a failed statement in an error whose message is the SQL
 * followed by every value bound to it: an address, a run's start, a
 * session token. Those values must reach neither Sentry nor the console
 * (law 7) nor a server function's caller. What is kept is what a person
 * acts on: the statement's first words (`insert into "runs"`) and the
 * database's own reason (`D1_ERROR: …`), which names columns, not values.
 *
 * Isomorphic: `src/start.ts` registers the scrub for every server function,
 * and `start.ts` is in the client bundle.
 */

/**
drizzle's shape for a failed statement: its own `query` and `params`.
*/
interface StatementError {
  readonly query: string;
  readonly params: unknown;
  readonly cause?: unknown;
}

function isStatementError(error: unknown): error is StatementError {
  return (
    error instanceof Error &&
    Object.hasOwn(error, "params") &&
    Object.hasOwn(error, "query") &&
    "query" in error &&
    typeof error.query === "string"
  );
}

/**
How far down a `cause` chain to look; a chain is a handful deep.
*/
const CAUSE_DEPTH = 5;

function statementIn(error: unknown): StatementError | undefined {
  let current = error;
  for (let depth = 0; depth <= CAUSE_DEPTH; depth += 1) {
    if (isStatementError(current)) return current;
    if (!(current instanceof Error)) return undefined;
    current = current.cause;
  }
  return undefined;
}

/**
The statement's verb and target, never its values.
*/
function firstWords(query: string): string {
  return query.trim().split(/\s+/u).slice(0, 3).join(" ");
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "no reason given";
}

/**
 * `error` unchanged when no failed statement is in it, else a new `Error`
 * that names the statement and the database's reason, with no `cause`: a
 * reporter that follows causes would otherwise send the values anyway.
 */
export function withoutBoundValues(error: unknown): unknown {
  const statement = statementIn(error);
  if (statement === undefined) return error;
  const failed = `failed statement ${firstWords(statement.query)}: ${messageOf(statement.cause)}`;
  return new Error(
    statement === error ? failed : `${messageOf(error)} (${failed})`,
  );
}
