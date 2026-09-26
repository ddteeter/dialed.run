import { redirect } from "@tanstack/react-router";

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

/**
 * The retired import status page's answer (round 22: *"`/runs/import/$id`
 * goes … the old URL redirects to A1"*), where every outcome now renders.
 *
 * Here, beside `runOrNotFound`, for the same reason as both below: a route
 * reaches it, and nothing in this file reaches the database.
 */
export function backToUpload(): never {
  throw redirect({ to: "/runs/new" }) as unknown;
}

/**
 * Run detail is a run *before its kit* (round 22, R: *"Once it has a
 * verdict, the route shows D instead"*). A run with an entry goes where
 * that entry is waiting: its post once it has a verdict, its verdict
 * before then — the step it is actually on.
 */
export function beforeItsEntry<
  T extends { entryId: string | undefined; hasVerdict: boolean },
>(run: T): T {
  const { entryId } = run;
  if (entryId === undefined) return run;
  throw redirect(
    run.hasVerdict
      ? { to: "/feed/entry/$entryId", params: { entryId } }
      : { to: "/feed/verdict/$entryId", params: { entryId } },
  ) as unknown;
}
