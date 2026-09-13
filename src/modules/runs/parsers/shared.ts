/**
 * Shared parser plumbing (102 §3). Every format-specific parser throws this
 * exact user-facing message on malformed input — never a thrown 500, per
 * the packet — so the queue consumer can surface it verbatim on the import
 * row and the "That file didn't parse" copy stays consistent everywhere.
 */
import { XMLParser } from "fast-xml-parser";

export const PARSE_FAILURE_MESSAGE =
  "That file didn't parse. Try the original export from your watch.";

/**
 * `message` is the user-facing copy and never varies. `reason` is the
 * diagnostic — which of the ~19 ways a file can fail to parse this was —
 * and `cause` carries the underlying library error where there was one.
 *
 * Both exist because the maintainer-facing half used to be thrown away:
 * every site threw the same argument-less error, so Sentry recorded "That
 * file didn't parse" nineteen different times with nothing to tell them
 * apart, and no way to see whether real users were hitting a decoder bug
 * or just uploading the wrong file. Never surface `reason` to a user.
 */
export class RunParseError extends Error {
  readonly reason: string;

  constructor(reason: string, options?: { cause?: unknown }) {
    super(PARSE_FAILURE_MESSAGE, options);
    this.name = "RunParseError";
    this.reason = reason;
  }
}

/**
 * The one XXE-safe XML parser, shared by GPX and TCX.
 *
 * `processEntities: false` disables DOCTYPE and entity expansion entirely,
 * so a hostile upload cannot smuggle an external-entity or billion-laughs
 * payload through. It was configured identically in both parsers — which
 * is one place for that decision to be changed and another to be forgotten.
 *
 * **Built per call, not at module scope, and that is a bundle decision
 * rather than a performance one (D-50).** `new XMLParser(…)` is a call
 * rollup cannot prove pure, so a module-scope one is a side effect it must
 * keep — and keeping it kept `fast-xml-parser` and its four dependencies,
 * ~63 kB, in the *client* entry chunk that every visitor downloads.
 * Nothing else in this file survived tree-shaking; that one constant did.
 *
 * Per call rather than memoised because the constructor only stores
 * options — the work is all in `parse` — and the caller is a queue
 * consumer handling one file per message. A cache here would buy nothing
 * and would mean assigning to a module binding from inside a function,
 * which is its own small trap.
 */
function xmlParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    processEntities: false,
  });
}

/**
 * Decodes and parses an uploaded XML document, or fails with the reason it
 * could not. `kind` names the format in the maintainer-facing reason; the
 * user reads the same sentence either way.
 */
export function parseXmlDocument(bytes: ArrayBuffer, kind: string): unknown {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new RunParseError(`${kind}: bytes are not valid UTF-8`, { cause: error });
  }
  try {
    return xmlParser().parse(text);
  } catch (error) {
    throw new RunParseError(`${kind}: XML parser threw`, { cause: error });
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
  // Equivalent mutant on the null check alone: `typeof null` is "object",
  // so dropping it lets null through — but every caller then reads a
  // property off it and throws, and no XML document this parser accepts
  // produces a bare null where an element is expected. The check is what
  // makes the guard a guard rather than a typeof.
  // Stryker disable next-line ConditionalExpression
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
