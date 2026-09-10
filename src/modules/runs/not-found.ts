/**
 * A missing run is a 404, not a crash.
 *
 * TanStack's own `notFound()` returns a plain options object rather than
 * an Error (thrown or returned, per its docs), and the house
 * `only-throw-error` rule rejects throwing that directly. So this is a
 * real Error carrying the `isNotFound` marker the router's `isNotFound()`
 * duck-types on.
 *
 * It lives in its own file, not in `service.ts`, because **a route imports
 * it and a route is in the client bundle.** `service.ts` imports the
 * drizzle schema, so importing this from there shipped every table
 * definition to the browser. Nothing here reaches the database or `env`,
 * which is the property a route-level import has to have.
 */
export class RunNotFoundError extends Error {
  readonly isNotFound = true;
}

export function runOrNotFound<T>(run: T | undefined): T {
  if (run === undefined) throw new RunNotFoundError("Run not found.");
  return run;
}
