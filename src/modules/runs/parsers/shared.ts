/**
 * Shared parser plumbing (102 §3). Every format-specific parser throws this
 * exact user-facing message on malformed input — never a thrown 500, per
 * the packet — so the queue consumer can surface it verbatim on the import
 * row and the "That file didn't parse" copy stays consistent everywhere.
 */
export const PARSE_FAILURE_MESSAGE =
  "That file didn't parse. Try the original export from your watch.";

export class RunParseError extends Error {
  constructor() {
    super(PARSE_FAILURE_MESSAGE);
    this.name = "RunParseError";
  }
}

export function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/**
Type guard, not a cast: GPX/TCX are parsed to `unknown` (trust boundary —
CLAUDE.md), and every field access below narrows through this rather than
an `as` assertion.
*/
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function readNumber(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export function readDate(value: unknown): Date | undefined {
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
Great-circle distance between two lat/lng points, in meters.
*/
export function haversineMeters(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const earthRadiusM = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const a =
    sinLat * sinLat +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * sinLon * sinLon;
  return 2 * earthRadiusM * Math.asin(Math.sqrt(a));
}
