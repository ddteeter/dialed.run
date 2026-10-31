/**
 * Route ids (design 165): the TanStack id of a screen, `/runs/$runId`,
 * which is what speed measurements group by. Never the URL: `/runs/abc`
 * and `/runs/def` are one screen, and a URL can carry an id the
 * measurement has no business holding.
 *
 * Isomorphic and pure. The real tree reaches this only through
 * `server.ts`, because `routeTree.gen` pulls every route and no test can
 * import it; the tests pin the matcher against that file's text instead.
 */
import { z } from "zod";

/**
 * A route as `routeTree.gen.ts` leaves it, as far as ids go: the generator
 * sets every route's `id` relative to its parent, and `_addFileChildren`
 * stores the children as an array.
 */
interface RouteNode {
  readonly options: { readonly id: string };
  readonly children?: readonly RouteNode[] | undefined;
}

const routeNodeSchema: z.ZodType<RouteNode> = z.lazy(() =>
  z.object({
    options: z.object({ id: z.string() }),
    children: z.array(routeNodeSchema).optional(),
  }),
);

const routeTreeSchema = z.object({ children: z.array(routeNodeSchema) });

function leavesUnder(prefix: string, nodes: readonly RouteNode[]): string[] {
  return nodes.flatMap((node) => {
    const id = prefix + node.options.id;
    return node.children === undefined ? [id] : leavesUnder(id, node.children);
  });
}

/**
 * The ids of every route a request can end on. A layout route (one with
 * children) is not one: `/desk` ends on its index, `/desk/`.
 */
export function leafRouteIds(tree: unknown): string[] {
  return leavesUnder("", routeTreeSchema.parse(tree).children);
}

/**
 * How specific a segment is, as one character of a sortable key, so
 * `/runs/backlog` beats `/runs/$runId` and both beat a splat, the order
 * TanStack itself matches in. Every key ends in `END`, which outranks a
 * splat: `/feed` is a better answer for `/feed` than `/feed/$`, which
 * matches it with nothing left over. `END` appears nowhere else, so no key
 * is a prefix of another and string order is the whole comparison.
 */
const LITERAL = "4";
const TEMPLATE = "3";
const PARAM = "2";
const END = "1";
const SPLAT = "0";

interface CompiledRoute {
  readonly id: string;
  readonly pattern: RegExp;
  readonly rank: string;
}

const escapeRegExp = (text: string): string =>
  text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

/**
 * A segment as a pattern and a rank. `@{$handle}` is a template: a param
 * inside literal text.
 */
function compileSegment(segment: string): [string, string] {
  if (segment === "$") return ["(?:/.*)?", SPLAT];
  if (segment.startsWith("$")) return ["/[^/]+", PARAM];
  if (segment.includes("{$")) {
    const literalParts = segment
      .split(/\{\$[^}]*\}/)
      .map((part) => escapeRegExp(part));
    return [`/${literalParts.join("[^/]+")}`, TEMPLATE];
  }
  return [`/${escapeRegExp(segment)}`, LITERAL];
}

/**
An id or a path without its trailing slash, so `/runs/` and `/runs` meet.
*/
const trimSlash = (path: string): string => path.replace(/\/$/, "");

function compileRoute(id: string): CompiledRoute {
  const segments = trimSlash(id)
    .split("/")
    .slice(1)
    .map((segment) => compileSegment(segment));
  const source = segments.map(([pattern]) => pattern).join("");
  return {
    id,
    pattern: new RegExp(`^${source}$`),
    rank: segments.map(([, rank]) => rank).join("") + END,
  };
}

/**
 * The route id a pathname ends on, or `undefined` for none. The compiled
 * table is built once per list: `server.ts` asks this on every request.
 */
export function routeMatcher(
  ids: readonly string[],
): (pathname: string) => string | undefined {
  const routes = ids
    .map((id) => compileRoute(id))
    .toSorted((a, b) => b.rank.localeCompare(a.rank));
  return (pathname) => {
    const path = trimSlash(pathname);
    return routes.find((route) => route.pattern.test(path))?.id;
  };
}
