/**
 * A belled page's loader: its own data and the bell, read side by side.
 * Every signed-in route wrote this `Promise.all` out by hand; a route that
 * uses this returns `{ data, bell }` and spreads `bell` into
 * `BelledLayout` (design 172; T1 is the first route on it).
 *
 * It composes promises rather than calling `bellStateFn` itself: a file
 * that imports `./functions` drags TanStack Start's server entry in and
 * cannot be tested (server.md), and a wrapper around `createServerFn`
 * does not typecheck. So the route passes both calls:
 * `withBell(getStravaStatusFn(), bellStateFn())`.
 */
export async function withBell<TData, TBell>(
  load: Promise<TData>,
  bell: Promise<TBell>,
): Promise<{ data: TData; bell: TBell }> {
  const [data, bellState] = await Promise.all([load, bell]);
  return { data, bell: bellState };
}
