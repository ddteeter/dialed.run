/**
 * The two answers a request can get that are not "here it is" and not "we
 * broke": the thing is not there, or it is not yours.
 *
 * They were three types in three modules before this — `feed`'s
 * `NotFoundError` defaulting its message, `closet`'s hard-coding "Item not
 * found." and taking no argument, and `runs`' `RunNotFoundError` carrying
 * an `isNotFound` marker for the router. Same concept, three shapes, and
 * anything wanting to handle "not found" uniformly had to know all three.
 *
 * That is the failure mode CLAUDE.md records for auth — "four private
 * copies had already become three incompatible error types before anyone
 * noticed" — and it is invisible to the clone detector in either mode,
 * because a restated *type* is not copied text. One gate per concern.
 *
 * **Keep them distinct from each other.** Collapsing them into one status
 * code is the tempting simplification and it is wrong: "no such entry" and
 * "someone else's entry" are the same HTTP 404 to a stranger on purpose,
 * but they are different facts internally, and a handler that cannot tell
 * them apart cannot decide which one to hide.
 */

/**
 * The row is not there — or, to this viewer, might as well not be.
 *
 * Carries `isNotFound` because TanStack's router duck-types on it: its own
 * `notFound()` returns a plain options object rather than an Error, and the
 * house `only-throw-error` rule refuses to throw that. So a real Error with
 * the marker is what lets a loader answer 404 instead of crashing.
 */
export class NotFoundError extends Error {
  readonly isNotFound = true;

  constructor(message = "not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

/**
 * The row exists and belongs to somebody else.
 *
 * Distinct from `NotFoundError` at the boundary where the decision is made,
 * even where the two are deliberately indistinguishable to the caller —
 * see the note above.
 */
export class ForbiddenError extends Error {
  constructor(message = "not allowed") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * An upstream we do not control did not give us what we asked for.
 *
 * Three modules had written this same five-line class — the page fetch, the
 * weather provider and the model adapter — and the clone detector was
 * right that they are one idea: a named error carrying a `cause`, thrown at
 * the boundary where something outside the app failed, and always caught by
 * the caller rather than surfaced (law 5). The `name` is what a handler
 * matches and a human reads in a report, so it stays per-subclass.
 *
 * **Distinct from `NotFoundError` and `ForbiddenError` above**, for the
 * reason this file already gives: those are answers about *our* data, and
 * collapsing a failed upstream into them would tell a caller the row is
 * missing when the truth is that nobody could reach the shop.
 */
export class UpstreamError extends Error {
  constructor(name: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = name;
  }
}
