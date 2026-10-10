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

import { returnPathOf } from "../../lib/return-path";

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
export function requireSignedIn<T>(
  session: T | null,
  location: Readonly<{ pathname: string; searchStr: string }>,
): T {
  // The guarded page rides along as log-in's way back, so a link to an
  // entry or a profile opened signed out lands there after signing in.
  if (session === null) {
    redirectTo({
      to: "/auth/login",
      search: { redirect: returnPathOf(location) },
    });
  }
  return session;
}

/**
 * `beforeLoad`'s gate as route context: the signed-in viewer's id, or the
 * log-in redirect. A route that needs the viewer reads `context.viewerId`
 * in its loader rather than asking for the session a second time — one
 * session read per navigation, and one gate rather than a gate and a
 * re-check. `getSession` is the caller's, so this stays importable by a
 * test while the route wires the server function in.
 */
export async function viewerContext(
  getSession: () => Promise<{ user: { id: string } } | null>,
  location: Readonly<{ pathname: string; searchStr: string }>,
): Promise<{ viewerId: string }> {
  return { viewerId: requireSignedIn(await getSession(), location).user.id };
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
`/@handle`'s one redirect: the viewer's own handle goes to G — H is for
somebody else, and it would offer them a Follow on themself.

Everything else is a page to render: the runner, "changed their name", or
"This runner isn't here." **A handle nobody ever held reaches that last
page, not the feed** (round 28 #11: it "covers purged, deleted and
never-existed handles on purpose, so no one can tell them apart"). So does
a runner the viewer may not see — banned, unconfirmed (D-113), leaving, or
in a block or report with them. `profileAtHandle` already answers all of
those with the `gone` a deleted account gets, so there is nothing to merge
here, and sending any of them anywhere different would say a runner is
behind the handle.
*/
export function orHandlePage(
  found: ProfileAtHandle,
): Exclude<ProfileAtHandle, { kind: "own" }> {
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
