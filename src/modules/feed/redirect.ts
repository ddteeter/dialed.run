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
import type { AnyRouter, RedirectOptions, RegisteredRouter } from "@tanstack/react-router";
import { redirect } from "@tanstack/react-router";

export function redirectTo<
  TRouter extends AnyRouter = RegisteredRouter,
  const TTo extends string | undefined = undefined,
  const TFrom extends string = string,
  const TMaskFrom extends string = TFrom,
  const TMaskTo extends string = "",
>(options: RedirectOptions<TRouter, TFrom, TTo, TMaskFrom, TMaskTo>): never {
  throw redirect(options) as unknown;
}
