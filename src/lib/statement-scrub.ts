/**
 * The server-function middleware that keeps a failed D1 statement's bound
 * values out of the answer (SA-L08). TanStack Start serializes a thrown
 * error's `message` to the caller, and drizzle's message carries every
 * value the statement was given; this rethrows such an error with them
 * removed (`withoutBoundValues`). Anything else, a zod refusal, a wire
 * error, a redirect, passes through as it was thrown.
 *
 * A function middleware, not a request middleware: a handler's error is a
 * result inside the function's own chain, and only `next()` here throws it.
 * Registered first in `src/start.ts`'s `functionMiddleware`.
 */
import { createMiddleware } from "@tanstack/react-start";

import { withoutBoundValues } from "./statement-error";

/**
 * What the middleware does with what `next` gave: the result, or the error
 * rethrown without bound values.
 */
export async function scrubbed<TResult>(
  next: () => Promise<TResult>,
): Promise<TResult> {
  try {
    return await next();
  } catch (error) {
    throw withoutBoundValues(error);
  }
}

/**
The middleware's server half: `next`, scrubbed.
*/
export function scrubNext<TResult>({
  next,
}: {
  readonly next: () => Promise<TResult>;
}): Promise<TResult> {
  return scrubbed(next);
}

export const statementScrub = createMiddleware({ type: "function" }).server(
  scrubNext,
);
