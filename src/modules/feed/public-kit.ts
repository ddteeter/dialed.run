/**
 * A public kit, read for the open web (round 41 #86c, D-149): what
 * `/k/<id>` and its card show to anyone, signed in or not.
 *
 * **One gate.** The entry is read through `worldVisibleEntry()` and
 * nothing else: PUBLIC, nothing pending or settled against it, its runner
 * neither banned nor leaving. Every other reason a kit is not public —
 * shared, private, removed, held, deleted, never existed — is the same
 * `undefined`, so the page and the card cannot tell them apart (#86f).
 *
 * **An explicit pick.** The result is built field by field from the rows
 * into `PublicKit`, which has no field for the run's start time, its
 * coordinates or route, a piece's flag or note, a Useful count or a
 * follow. The runner's id leaves beside the kit, for the cache tags only,
 * and never reaches the page.
 *
 * **In the runner's units and on the runner's day.** A visitor has no
 * units of their own, so the runner's are used (`unitsFor`), and the day
 * is where the run was: its observation's zone (R-96, as every run date
 * the app shows), else the runner's own place's zone, else UTC. A day,
 * never a time (D-149).
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import {
  domainDenylist,
  outfitEntries,
  outfitEntryItems,
  runs,
  userProfiles,
  wardrobeItems,
} from "../../db/schema-core";
import { coreDb } from "../../env";
import {
  garmentCategoryLabels,
  verdictScale,
  type Units,
  type VerdictValue,
} from "../../lib/contracts";
import {
  distanceNumber,
  formatDuration,
  gainNumber,
  paceNumber,
} from "../../lib/contracts/measures";
import { formatTemp, precipClassOf } from "../../lib/contracts/temperature";
import { entryCacheTag } from "../../lib/cache-tags";
import { dayLabel, isTimeZone } from "../../lib/dates";
import { domainOf } from "../../lib/domain";
import { ulidSchema } from "../../lib/ids";
import { firstRowWhere } from "../../lib/sql/keyed-read";
import {
  kitCardResponse,
  publicPageHeaders,
  publicPageTags,
  type EntryCardData,
} from "../ops";
import { worldVisibleEntry } from "../safety";

import { observationsForRuns, type Conditions } from "./conditions";
import { judgedFeelsLikeC } from "./judged-conditions";
import type { PublicKit, PublicPiece } from "./public-kit-shape";
import { isProvidersReading } from "./strip";
import { unitsFor } from "./units";

type Database = DrizzleD1Database;
type Run = typeof runs.$inferSelect;

/**
 * The kit and the runner whose it is, or nothing: not public, for every
 * reason alike.
 */
export interface PublicKitRead {
  readonly kit: PublicKit;
  readonly runnerId: string;
}

export async function publicKitRead(
  entryId: string,
): Promise<PublicKitRead | undefined> {
  // A path that is not an id is a kit that never existed, without a read.
  const id = ulidSchema.safeParse(entryId);
  if (!id.success) return undefined;
  const database = coreDb();
  const entry = await firstRowWhere(
    database,
    outfitEntries,
    and(eq(outfitEntries.id, id.data), worldVisibleEntry()),
  );
  if (entry === undefined) return undefined;
  const [run, runner] = await Promise.all([
    firstRowWhere(database, runs, eq(runs.id, entry.runId)),
    firstRowWhere(
      database,
      userProfiles,
      eq(userProfiles.userId, entry.userId),
    ),
  ]);
  // A handle is how the page names its runner; a runner with none has
  // nothing to show under (and cannot have got past O0 to share one).
  if (run === undefined || typeof runner?.username !== "string") {
    return undefined;
  }
  const [units, pieces, observed] = await Promise.all([
    unitsFor(database, entry.userId),
    piecesOf(database, entry.id),
    observationsForRuns([run]),
  ]);
  const conditions = observed.get(run.id);
  const verdict = verdictOf(entry.verdict);
  const kit = {
    entryId: entry.id,
    handle: runner.username,
    day: runDayOf(run.startedAt, conditions, runner.timeZone),
    ...conditionsOf(conditions, entry.verdict, units),
    ...(verdict !== undefined && { verdict }),
    ...statsOf(run, units),
    ...(entry.caption !== null && { caption: entry.caption }),
    pieces,
  };
  return {
    kit: { ...kit, cardVersion: await versionOf(entryCardOf(kit)) },
    runnerId: entry.userId,
  };
}

/**
 * The run's day where it was run (R-96), never a time: its observation's
 * zone, else the runner's own place's, else UTC. The profile's kit rows
 * date their runs with it too.
 */
export function runDayOf(
  startedAt: number,
  conditions: Conditions | undefined,
  runnerZone: string | null,
): string {
  const zone = conditions?.timeZone ?? runnerZone ?? undefined;
  return dayLabel(startedAt, isTimeZone(zone) ? zone : undefined);
}

/**
A stored verdict as one on the scale, or none.
*/
export function verdictOf(stored: number | null): VerdictValue | undefined {
  return verdictScale.find((step) => step.value === stored)?.value;
}

/**
 * Feels-like at the hour the verdict judged (`judgedFeelsLikeC`, R-5), the
 * sky as the precipitation class the app says it in, and whether the
 * reading is the provider's. A field to spread: nothing for no conditions.
 */
export function conditionsOf(
  conditions: Conditions | undefined,
  verdict: number | null,
  units: Units,
): Pick<PublicKit, "conditions"> {
  if (conditions === undefined) return {};
  return {
    conditions: {
      feelsLike: formatTemp(judgedFeelsLikeC(conditions, verdict), units.temp),
      sky: precipClassOf(conditions.precipMm),
      isProviders: isProvidersReading(conditions),
    },
  };
}

/**
 * The four stats (round 41 #86c): distance, moving time, pace and gain.
 * Moving time is the file's when it had one, else the run's own time,
 * which is what a manual run records; pace is over the same time. Pace is
 * absent with no distance and gain with no altitude.
 */
function statsOf(
  run: Run,
  units: Units,
): Pick<PublicKit, "distance" | "time" | "pace" | "gain"> {
  const seconds = run.movingS ?? run.durationS;
  const pace = paceNumber(seconds, run.distanceM, units.distance);
  return {
    distance: {
      value: distanceNumber(run.distanceM, units.distance),
      unit: units.distance,
    },
    time: { value: formatDuration(seconds), isMoving: run.movingS !== null },
    ...(pace !== undefined && {
      pace: { value: pace, unit: `/${units.distance}` },
    }),
    ...(run.elevationGainM !== null && {
      gain: gainNumber(run.elevationGainM, units.distance),
    }),
  };
}

/**
 * The columns a public piece is read from — built on first use, not at
 * module scope, so nothing here keeps the schema alive in a bundle that
 * only names this file.
 */
function pieceColumns() {
  return {
    name: wardrobeItems.name,
    brand: wardrobeItems.brand,
    category: wardrobeItems.category,
    productUrl: wardrobeItems.productUrl,
  };
}

/**
 * The pieces, in the order they were put on the kit, each with its product
 * link when it has one whose domain the denylist allows (packet §3): a
 * link an operator has since denied is not passed on to the open web.
 * A link that does not parse is no link.
 */
async function piecesOf(
  database: Database,
  entryId: string,
): Promise<PublicPiece[]> {
  const rows = await database
    .select(pieceColumns())
    .from(outfitEntryItems)
    .innerJoin(wardrobeItems, eq(wardrobeItems.id, outfitEntryItems.itemId))
    .where(eq(outfitEntryItems.entryId, entryId))
    // The order they were attached in: the table has no position column,
    // and its index would otherwise hand them back by item id.
    .orderBy(sql`${outfitEntryItems}.rowid`);
  const denied = await deniedDomains(
    database,
    rows.map((row) => domainOf(row.productUrl ?? undefined)),
  );
  return rows.map((row) => {
    const url = allowedLink(row.productUrl, denied);
    return {
      name: row.brand === null ? row.name : `${row.brand} ${row.name}`,
      model: row.name,
      kind: garmentCategoryLabels[row.category],
      ...(url !== undefined && { url }),
    };
  });
}

/**
A product link to pass on: one that parses, to a domain not denied.
*/
function allowedLink(
  url: string | null,
  denied: ReadonlySet<string>,
): string | undefined {
  const domain = domainOf(url ?? undefined);
  if (domain === undefined || denied.has(domain)) return undefined;
  return url ?? undefined;
}

/**
Which of these domains the denylist holds, in one read by its key.
*/
async function deniedDomains(
  database: Database,
  domains: readonly (string | undefined)[],
): Promise<Set<string>> {
  const named = [...new Set(domains.filter((domain) => domain !== undefined))];
  const rows = await database
    .select({ domain: domainDenylist.domain })
    .from(domainDenylist)
    .where(inArray(domainDenylist.domain, named));
  return new Set(rows.map((row) => row.domain));
}

/**
 * What the share card shows of a kit (round 41 #86e): the handle and the
 * day, the conditions and the verdict, the stats as one line, the models
 * without brands, and whether the credit is owed. Never the caption.
 */
export function entryCardOf(
  kit: Omit<PublicKit, "cardVersion">,
): EntryCardData {
  const stats = [
    `${kit.distance.value} ${kit.distance.unit}`,
    kit.time.value,
    ...(kit.pace === undefined ? [] : [`${kit.pace.value} ${kit.pace.unit}`]),
    ...(kit.gain === undefined ? [] : [`${kit.gain.value} ${kit.gain.unit}`]),
  ];
  return {
    handle: kit.handle,
    day: kit.day,
    ...(kit.conditions !== undefined && {
      conditions: {
        feelsLike: kit.conditions.feelsLike,
        sky: kit.conditions.sky,
      },
    }),
    ...(kit.verdict !== undefined && { verdict: kit.verdict }),
    stats: stats.join(" · "),
    kit: kit.pieces.map((piece) => piece.model),
    isCredited: kit.conditions?.isProviders ?? false,
  };
}

/**
 * The card's version: the first 16 hex digits of a SHA-256 of what it
 * shows, so any edit that changes the card changes its URL, and nothing
 * else does.
 */
async function versionOf(card: EntryCardData): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(card));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  // Two digits a byte, each looked up rather than padded, so a byte under
  // 16 is still two digits whatever this digest happens to hold.
  return [...digest]
    .slice(0, 8)
    .map(
      (byte) =>
        `${HEX_DIGITS.charAt(byte >> 4)}${HEX_DIGITS.charAt(byte & 15)}`,
    )
    .join("");
}

const HEX_DIGITS = "0123456789abcdef";

/**
 * The kit's own tag: a path that is not an id names nothing a purge could.
 */
function kitTag(entryId: string): string | undefined {
  return ulidSchema.safeParse(entryId).success
    ? entryCacheTag(entryId)
    : undefined;
}

/**
 * The page's cache headers (design 160, D-152): a minute at the edge,
 * public or not, tagged with the kit and — when public — its runner.
 */
export function publicKitHeaders(
  entryId: string,
  read: PublicKitRead | undefined,
): Record<string, string> {
  return publicPageHeaders(kitTag(entryId), read?.runnerId);
}

/**
 * The page's read, for its server function: the kit or nothing, with the
 * headers the page must leave with handed to `setHeaders` (the framework's
 * `setResponseHeaders`, passed in so this stays testable).
 */
export async function publicKitForPage(
  entryId: string,
  setHeaders: (headers: Record<string, string>) => void,
): Promise<PublicKit | undefined> {
  const read = await publicKitRead(entryId);
  setHeaders(publicKitHeaders(entryId, read));
  return read?.kit;
}

/**
 * `/og/k/<id>`: the kit's card when it is public, the default card for
 * every other reason (round 41 #86e).
 */
export async function publicKitCardResponse(
  request: Request,
  entryId: string,
): Promise<Response> {
  const read = await publicKitRead(entryId);
  return kitCardResponse(request, entryId, {
    ...(read !== undefined && {
      found: {
        card: entryCardOf(read.kit),
        version: read.kit.cardVersion,
      },
    }),
    tags: publicPageTags(kitTag(entryId), read?.runnerId),
  });
}
