/**
 * How TanStack Start reads a server function's id from a path, read with
 * the framework's own normaliser so there is no second decoder to drift
 * from it: the path is decoded (`%5F` is `_`), then the id is the first
 * segment after the prefix (`createStartHandler`, start-server-core).
 */
import { getNormalizedURL } from "@tanstack/react-router/ssr/server";

/**
 * TanStack Start's prefix for a server function call: the default base,
 * since `vite.config.ts` gives `tanstackStart()` no options.
 */
export const SERVER_FN_PREFIX = "/_serverFn/";

/**
 * The server function id a path names, `""` for a server-function path
 * with no id, or `undefined` for a path that is not a server function's.
 */
export function serverFnIdOf(url: URL): string | undefined {
  const { pathname } = getNormalizedURL(url).url;
  return pathname.startsWith(SERVER_FN_PREFIX)
    ? pathname.slice(SERVER_FN_PREFIX.length).split("/", 1)[0]
    : undefined;
}

/**
 * A server-function path that names no function. `server.ts` answers it
 * with a 404 before the framework reads it.
 */
export function isServerFnWithoutId(url: URL): boolean {
  return serverFnIdOf(url) === "";
}
