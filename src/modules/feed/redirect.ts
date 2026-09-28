/**
 * `throw redirect(...)` is TanStack Router's documented way to trigger a
 * navigation from `beforeLoad`/`loader` — but `Redirect` extends `Response`,
 * not `Error`, so the house `only-throw-error` lint rule flags every such
 * throw as a framework/lint mismatch, not a real bug. This wraps the throw
 * once, behind the rule's own `allowThrowingUnknown` escape valve (an
 * identity `as unknown` cast — no `any`, no behavior change, the exact same
 * `Redirect` Response instance still reaches `isRedirect()`); the generic
 * signature mirrors `redirect()` itself so callers keep full compile-time
 * route/param validation.
 */
import type {
  AnyRouter,
  RedirectOptions,
  RegisteredRouter,
} from "@tanstack/react-router";
import { redirect } from "@tanstack/react-router";

import type { ProfileAtHandle } from "./profiles";

export function redirectTo<
  TRouter extends AnyRouter = RegisteredRouter,
  const TTo extends string | undefined = undefined,
  const TFrom extends string = string,
  const TMaskFrom extends string = TFrom,
  const TMaskTo extends string = "",
>(options: RedirectOptions<TRouter, TFrom, TTo, TMaskFrom, TMaskTo>): never {
  throw redirect(options) as unknown;
}

/**
 * The two gates every signed-in feed screen repeats.
 *
 * They were an `if` in each route's `beforeLoad`, which is the one place
 * in this codebase a decision cannot be tested — a route file imports a
 * module's `functions.ts` and so cannot be imported by any test. Here they
 * are ordinary functions with ordinary tests, and the route reads as the
 * wiring it is.
 */
export function requireSignedIn<T>(session: T | null): T {
  if (session === null) redirectTo({ to: "/auth/login" });
  return session;
}

/**
Back to the feed for anything the viewer may not see, or that is not there.
The two are deliberately the same answer: telling someone a private entry
exists is most of what they wanted to know.
*/
export function orBackToFeed<T>(value: T | undefined): T {
  if (value === undefined) redirectTo({ to: "/feed" });
  return value;
}

/**
`/@handle`'s two redirects. A handle nobody may be shown goes back to the
feed, the answer every feed route gives for "not there, or not yours to
see". The viewer's own handle goes to G — H is for somebody else, and it
would offer them a Follow on themself.

What is left is a page to render: the runner, or "changed their name".
*/
export function orHandlePage(
  result: ProfileAtHandle | undefined,
): Exclude<ProfileAtHandle, { kind: "own" }> {
  const found = orBackToFeed(result);
  if (found.kind === "own") redirectTo({ to: "/feed/me" });
  return found;
}

/**
`/feed/u/$userId`'s answer: the runner's `/@handle`, or back to the feed
for a runner the viewer may not see — or one with no handle, which after
O0 no runner has, and which would have no page to go to.
*/
export function toHandlePage(
  profile: { username: string | null } | undefined,
): never {
  const handle = orBackToFeed(orBackToFeed(profile).username ?? undefined);
  return redirectTo({ to: "/@{$handle}", params: { handle } });
}
