/**
 * The styling audit's capture decisions (design 205), kept apart from the
 * Playwright side in `e2e/support/audit-shot.ts` so they can be tested and
 * mutated: which route a URL is, when two moments are the same screen
 * state, how many states a route may take, and where each shot goes.
 *
 * A state is the route plus the set of visible elements described by their
 * tag, parent tag, slot and ARIA state. So a sheet opening, a tab being
 * pressed or a field turning invalid is a new state, and typing a letter
 * is not.
 */
import { z } from "zod";

/**
The two widths every state is shot at: the phone and the desk.
*/
export const SHOT_SIZES = {
  phone: { width: 390, height: 844 },
  desk: { width: 1280, height: 800 },
} as const;

export type ShotSize = keyof typeof SHOT_SIZES;

/**
Shots per state, in the order they are taken.
*/
export const SHOT_ORDER: readonly {
  scheme: "light" | "dark";
  size: ShotSize;
}[] = [
  { scheme: "light", size: "phone" },
  { scheme: "light", size: "desk" },
  { scheme: "dark", size: "phone" },
  { scheme: "dark", size: "desk" },
];

/**
A route with more distinct states than this stops being shot.
*/
export const CAP_PER_ROUTE = 16;

/**
The tallest shot, in px, unless `AUDIT_MAX_HEIGHT` says otherwise.
*/
const DEFAULT_MAX_HEIGHT = 9000;

/**
The attributes that make one moment a different state from another.
*/
export const STATE_ATTRIBUTES = [
  "aria-pressed",
  "aria-checked",
  "aria-selected",
  "aria-invalid",
  "aria-expanded",
  "aria-current",
  "aria-busy",
  "aria-disabled",
  "open",
  "data-state",
] as const;

/**
 * A path segment that names a row rather than a screen: a ULID or other
 * long id, a handle with a numeric suffix (`trail_604311`), or a number.
 */
function isIdSegment(segment: string): boolean {
  return (
    segment.length >= 16 || /_\d{6}$/u.test(segment) || /^\d+$/u.test(segment)
  );
}

/**
 * The route a URL is, with ids folded to `:id` and the query reduced to its
 * sorted keys, so `/runs/01J…?b=2&a=1` and `/runs/01K…?a=9&b=0` are the
 * same route.
 */
export function routeOf(pathname: string, search: string): string {
  const path = pathname
    .split("/")
    .map((segment) => (isIdSegment(segment) ? ":id" : segment))
    .join("/");
  const keys = [...new URLSearchParams(search)]
    .map(([key]) => key)
    .toSorted((left, right) => left.localeCompare(right));
  return keys.length === 0 ? path : `${path}?${keys.join("&")}`;
}

/**
 * One visible element, as the state key sees it:
 * `PARENT>TAG.slot[attr=value,…]`.
 */
export function describePart(part: {
  parent: string;
  tag: string;
  slot: string;
  states: readonly (readonly [string, string])[];
}): string {
  const states = part.states
    .map(([name, value]) => `${name}=${value}`)
    .join(",");
  return `${part.parent}>${part.tag}.${part.slot}[${states}]`;
}

/**
 * The state key: the route and a 32-bit hash of the distinct parts,
 * independent of their order on the page.
 */
export function stateKey(route: string, parts: readonly string[]): string {
  const distinct = [...new Set(parts)].toSorted((left, right) =>
    left.localeCompare(right),
  );
  let hash = 0;
  for (const part of distinct) {
    for (let index = 0; index < part.length; index += 1) {
      // Math.imul wraps to 32 bits, so the hash cannot grow past a safe integer.
      hash = Math.imul(hash, 31) + (part.codePointAt(index) ?? 0);
    }
  }
  return `${route}#${String(Math.imul(hash, 1))}`;
}

/**
The folder a route's shots go in: one safe path segment, never empty.
*/
export function slugOf(route: string): string {
  const words = route.split(/[^\w@:-]/u).filter((word) => word !== "");
  return words.length === 0 ? "root" : words.join("_");
}

/**
 * A query key no screen reads, made from a state's name (`z-<words>`, at
 * most 40 characters of words). `shoot` sets it so a state that changes
 * nothing the key sees is still a state of its own.
 */
export function forcedKey(what: string): string {
  const words = what
    .toLowerCase()
    .split(/[^a-z0-9]/u)
    .filter((word) => word !== "");
  return `z-${words.join("-").slice(0, 40)}`;
}

/**
 * The URL with its `z-` keys swapped for this state's, every other query
 * parameter and the hash kept.
 */
export function withForcedKey(href: string, what: string): string {
  const url = new URL(href);
  const names = Object.keys(Object.fromEntries(url.searchParams));
  for (const name of names) {
    if (name.startsWith("z-")) url.searchParams.delete(name);
  }
  url.searchParams.set(forcedKey(what), "1");
  return url.href;
}

/**
A shot's file name: the state's number on its route, the size, the scheme.
*/
export function shotName(
  number: number,
  shot: { scheme: "light" | "dark"; size: ShotSize },
): string {
  return `${String(number).padStart(2, "0")}-${shot.size}-${shot.scheme}.png`;
}

/**
 * The viewport height a shot is taken at: the document's, so a fixed bar
 * sits at the bottom of the shot, but never below the size's own height
 * and never above the cap.
 */
export function shotHeight(
  documentHeight: number,
  viewportHeight: number,
  max: number,
): number {
  return Math.max(viewportHeight, Math.min(documentHeight, max));
}

/**
`AUDIT_MAX_HEIGHT` as a positive whole number of px, or the default.
*/
export function maxHeightFrom(value: string | undefined): number {
  const parsed = z.coerce.number().int().positive().safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_MAX_HEIGHT;
}

/**
One line of `index.jsonl`: a state that was shot, and where.
*/
export const indexRowSchema = z.object({
  key: z.string().min(1),
  route: z.string(),
  url: z.string(),
  test: z.string(),
  width: z.number().int().positive(),
  files: z.array(z.string()),
});

export type IndexRow = z.infer<typeof indexRowSchema>;

/**
 * What has been shot so far, so a re-run into the same folder adds only new
 * states and the per-route cap holds across runs.
 */
export class ShotLedger {
  private readonly seen = new Set<string>();
  private readonly perRoute = new Map<string, number>();

  /**
  Reads an existing `index.jsonl`. A line that is not a row is an error.
  */
  constructor(index = "") {
    for (const line of index.split("\n")) {
      if (line.trim() === "") continue;
      const row = indexRowSchema.parse(JSON.parse(line));
      this.record(row.route, row.key);
    }
  }

  private record(route: string, key: string): void {
    this.seen.add(key);
    this.perRoute.set(route, (this.perRoute.get(route) ?? 0) + 1);
  }

  /**
   * Claims a state for shooting. Returns its number on the route (from 1),
   * or `undefined` when it was shot already or the route is at its cap.
   */
  claim(route: string, key: string): number | undefined {
    if (this.seen.has(key)) return undefined;
    const count = this.perRoute.get(route) ?? 0;
    if (count >= CAP_PER_ROUTE) return undefined;
    this.record(route, key);
    return count + 1;
  }
}

/**
The `index.jsonl` line for a shot state.
*/
export function indexLine(row: IndexRow): string {
  return `${JSON.stringify(indexRowSchema.parse(row))}\n`;
}
