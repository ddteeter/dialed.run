/**
 * Photos that match a reported one by fingerprint, from any runner,
 * private included (D-142, design 146): the hashed half of the TAKE IT
 * DOWN Act's reasonable effort on copies, beside the same runner's other
 * photos (`other-photos.ts`), which a person looks through.
 *
 * **Filtered in SQL, scanning by necessity.** A match is a Hamming
 * distance of at most `FINGERPRINT_MATCH_DISTANCE` bits, and no index can
 * seek on a distance. SQLite has no popcount either, so the distance is
 * spelt out: for each of the 16 hex digits, a 16-character string
 * (`digitDistances`) says how many bits every possible stored digit
 * differs from the subject's by, and `substr` picks the stored digit's
 * entry. The sum is the distance, and the `WHERE` and the `LIMIT` both
 * apply to it — the first N matches, never the matches among the first N
 * rows.
 *
 * **The cost is bounded by who asks.** Each subject reads every kit photo
 * and every garment once, and only when an operator opens Review with a
 * row an intimate-image report or a removal request started. Nothing a
 * runner opens reaches it.
 */
import {
  and,
  asc,
  eq,
  isNotNull,
  lte,
  not,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

import {
  entryPhotos,
  outfitEntries,
  userProfiles,
  wardrobeItems,
} from "../../db/schema-core";
import { strangerAudiences } from "../../lib/contracts";
import {
  FINGERPRINT_MATCH_DISTANCE,
  fingerprintSchema,
} from "../../lib/photo-fingerprint";
import { distanceBetweenSql } from "../../lib/sql/fingerprint-distance";
import { inJsonList, jsonField, jsonTable } from "../../lib/sql/json-list";
import { subjectColumns, type OtherPhotosSubject } from "./other-photos";
import { publiclyVisibleEntry } from "./visibility";

type Db = ReturnType<typeof drizzle>;

/**
 * How many matches of each kind a row lists, nearest first. A bound for
 * the page's sake, as `OTHER_PHOTOS_LIMIT` is; a picture copied more
 * often than this is one an operator has already found.
 */
export const PHOTO_MATCHES_LIMIT = 12;

/**
 * One matching photo. `photoKey` is the object `/desk/review-photo/`
 * serves; `distance` is how many bits apart it is, 0 for the same
 * picture. Whose it is — the owner, and their handle when they have one,
 * for the link to D8 (round 39 #71). A kit photo carries its kit, for the
 * link to its page, and whether that kit is shared; a garment photo is
 * never shown to another runner, so it has no page an operator can open.
 */
export type PhotoMatch = Readonly<
  {
    id: string;
    photoKey: string;
    distance: number;
    ownerId: string;
    handle: string | undefined;
    /**
    A kit not shared with runners; a garment, never shown to anyone, is not tagged.
    */
    isPrivate: boolean;
  } & (
    | { kind: "kit"; entryId: string; canOpen: boolean }
    | { kind: "garment"; canOpen: false }
  )
>;

/**
 * What a row shows of the search: its matches, and whether there was
 * anything to search by. A subject with no fingerprint — gone already,
 * or uploaded before fingerprints — has none, and "no matches" would say
 * something false about it.
 */
export interface PhotoMatches {
  readonly fingerprinted: boolean;
  readonly matches: readonly PhotoMatch[];
  /**
   * Whether either list had more than `PHOTO_MATCHES_LIMIT` (design 164):
   * the count is then a floor, and Review says "12+" rather than a number
   * the search never finished counting.
   */
  readonly isCutOff: boolean;
}

/**
 * Each subject's matches, by `subjectType:subjectId`.
 *
 * **Three statements for the page, however many rows it has** (design
 * 188, #490). One read finds every subject's fingerprints; a batch cannot
 * branch on its own results, so the searches follow it, both in one batch,
 * each searching for every subject at once. A subject's fingerprints reach
 * the searches as one bound JSON list (`lib/sql/json-list.ts`) and are
 * compared column to column (`distanceBetweenSql`), so neither the
 * parameters nor the statement's text grow with the page.
 */
export async function photoMatchesOf(
  db: Db,
  subjects: readonly OtherPhotosSubject[],
): Promise<Map<string, PhotoMatches>> {
  if (subjects.length === 0) return new Map();
  const probes = await probesOf(db, subjects);
  const [kitsRead, garmentsRead] =
    probes.length === 0
      ? [[], []]
      : await db.batch([kitMatches(db, probes), garmentMatches(db, probes)]);
  return new Map(
    subjects.map((subject) => {
      const key = keyOf(subject);
      const isSearched = probes.some((probe) => probe.key === key);
      return [
        key,
        isSearched
          ? matchesFrom(
              matchesUnder(kitsRead, key),
              matchesUnder(garmentsRead, key),
            )
          : NOTHING_TO_SEARCH_BY,
      ];
    }),
  );
}

/**
A subject's matches among a search's rows, each answered under its key.
*/
function matchesUnder<T>(
  rows: readonly Readonly<{ key: string; match: T }>[],
  key: string,
): T[] {
  return rows.filter((row) => row.key === key).map((row) => row.match);
}

/**
 * The answer for a subject with no fingerprint — gone already, or
 * uploaded before fingerprints: "no matches" would say something false.
 */
const NOTHING_TO_SEARCH_BY: PhotoMatches = {
  fingerprinted: false,
  matches: [],
  isCutOff: false,
};

/**
 * One subject's matches as the row shows them, from its rows of each
 * search, each nearest first and read one past the limit.
 */
function matchesFrom(
  kitsRead: readonly KitRow[],
  garmentsRead: readonly GarmentRow[],
): PhotoMatches {
  // One past the limit was read, to know whether there were more.
  const isCutOff = [kitsRead, garmentsRead].some(
    (rows) => rows.length > PHOTO_MATCHES_LIMIT,
  );
  const kits = kitsRead.slice(0, PHOTO_MATCHES_LIMIT);
  const garments = garmentsRead.slice(0, PHOTO_MATCHES_LIMIT);
  // Nearest first, a kit before a garment at the same distance (round 39
  // #71): each list is nearest first already, and the sort is stable.
  const matches: PhotoMatch[] = [
    ...kits.map((row) => ({
      kind: "kit" as const,
      ...row,
      handle: row.handle ?? undefined,
    })),
    ...garments.map((row) => ({
      kind: "garment" as const,
      canOpen: false as const,
      isPrivate: false,
      ...row,
      handle: row.handle ?? undefined,
    })),
  ];
  return {
    fingerprinted: true,
    matches: matches.toSorted((one, other) => one.distance - other.distance),
    isCutOff,
  };
}

function keyOf(subject: OtherPhotosSubject): string {
  return `${subject.subjectType}:${subject.subjectId}`;
}

/**
 * One fingerprint a subject is searched by, with whose it is: the
 * subject's key, which the searches answer under, and the subject itself,
 * whose own photos a kit search leaves out.
 */
interface Probe {
  readonly key: string;
  readonly subjectType: OtherPhotosSubject["subjectType"];
  readonly subjectId: string;
  readonly print: string;
}

/**
 * Every subject's fingerprints, in one read: a photo's own, or every
 * photo's on a kit. Served by the primary key and the
 * `entry_photos_idempotency` prefix.
 */
async function probesOf(
  db: Db,
  subjects: readonly OtherPhotosSubject[],
): Promise<Probe[]> {
  const idsOf = (type: OtherPhotosSubject["subjectType"]) =>
    subjects
      .filter((subject) => subject.subjectType === type)
      .map((subject) => subject.subjectId);
  const ofSubjects = or(
    inJsonList(entryPhotos.id, idsOf("photo")),
    inJsonList(entryPhotos.entryId, idsOf("entry")),
  );
  const rows = await db
    .select({
      id: entryPhotos.id,
      entryId: entryPhotos.entryId,
      fingerprint: entryPhotos.fingerprint,
    })
    .from(entryPhotos)
    .where(and(ofSubjects, isNotNull(entryPhotos.fingerprint)));
  return subjects.flatMap((subject) =>
    rows
      .filter((row) => OWN[subject.subjectType](row) === subject.subjectId)
      .map((row) => ({
        key: keyOf(subject),
        subjectType: subject.subjectType,
        subjectId: subject.subjectId,
        // Parsed, not trusted: a malformed fingerprint is a bug, so it
        // throws rather than quietly searching for nothing.
        print: fingerprintSchema.parse(row.fingerprint),
      })),
  );
}

/**
What a subject's own photos share with it: the photo's id, or its kit's.
*/
const OWN = {
  photo: (row: Readonly<{ id: string }>) => row.id,
  entry: (row: Readonly<{ entryId: string }>) => row.entryId,
} as const;

/**
 * The probes as a table the searches join: one row a fingerprint, the
 * list bound as one parameter.
 */
function probeTable(db: Db, probes: readonly Probe[]) {
  return jsonTable(db, "probe", probes, {
    ...subjectColumns("probe"),
    print: jsonField<string>("print").as("probe_print"),
  });
}

type ProbeTable = ReturnType<typeof probeTable>;

/**
 * What a match row says of whose photo it is, whichever kind it is: the
 * owner, and their handle by a primary-key probe of `user_profiles`, for
 * the link to D8 (round 39 #71).
 */
function ownerColumns<Owner extends SQLiteColumn>(
  ranked: Readonly<{ distance: SQL.Aliased<number> }>,
  owner: Owner,
) {
  return {
    distance: ranked.distance,
    ownerId: owner,
    handle: sql<
      string | null
    >`(SELECT ${userProfiles.username} FROM ${userProfiles} WHERE ${userProfiles.userId} = ${owner})`,
  };
}

/**
 * The search both kinds share: the nearest of each subject's fingerprints
 * to each photo within the distance, then each subject's nearest
 * `PHOTO_MATCHES_LIMIT + 1`. The photo table is the outer loop (`CROSS
 * JOIN` keeps SQLite from turning it), so each stored photo is read once
 * for the whole page, as one subject's search read it before.
 *
 * What it answers is a `WITH` to select from, `ranked` to select and join
 * by, and the filter and order every search ends on.
 */
function nearestPerSubject(
  db: Db,
  probes: readonly Probe[],
  photo: Readonly<{ id: SQLiteColumn; print: SQLiteColumn }>,
  ownPhotos?: (probe: ProbeTable) => SQL,
) {
  const probe = probeTable(db, probes);
  const distance = distanceBetweenSql(photo.print, sql`${probe.print}`);
  // No `IS NOT NULL`: a photo with no fingerprint has a NULL distance,
  // which no comparison keeps.
  const kept = and(
    lte(distance, FINGERPRINT_MATCH_DISTANCE),
    ownPhotos === undefined ? undefined : not(ownPhotos(probe)),
  );
  const near = db.$with("near").as(
    db
      .select({
        key: probe.key,
        photoId: photo.id,
        distance: sql<number>`min(${distance})`.as("near_distance"),
      })
      .from(photo.id.table)
      .crossJoin(probe)
      .where(kept)
      .groupBy(sql`${probe.key}`, photo.id),
  );
  const ranked = db.$with("ranked").as(
    db
      .select({
        key: near.key,
        photoId: near.photoId,
        distance: sql<number>`${near.distance}`
          .mapWith(Number)
          .as("ranked_distance"),
        place:
          sql<number>`row_number() over (partition by ${near.key} order by ${near.distance}, ${near.photoId})`.as(
            "ranked_place",
          ),
      })
      .from(near),
  );
  return {
    search: db.with(probe, near, ranked),
    ranked,
    // One past the limit, to know whether there were more.
    isShown: lte(ranked.place, PHOTO_MATCHES_LIMIT + 1),
    nearestFirst: [asc(ranked.key), asc(ranked.place)] as const,
  };
}

/**
 * Kit photos within the distance of each subject, nearest first, the
 * subject's own left out — it is on the row already. Private kits are not
 * left out (D-142): a copy is no less a copy for being posted privately.
 */
function kitMatches(db: Db, probes: readonly Probe[]) {
  const { search, ranked, isShown, nearestFirst } = nearestPerSubject(
    db,
    probes,
    { id: entryPhotos.id, print: entryPhotos.fingerprint },
    // Parenthesised whole: `not()` spells `not <condition>`, which binds
    // tighter than the `or` inside it.
    (probe) =>
      sql`((${probe.subjectType} = 'photo' and ${entryPhotos.id} = ${probe.subjectId}) or (${probe.subjectType} = 'entry' and ${entryPhotos.entryId} = ${probe.subjectId}))`,
  );
  const owner = outfitEntries.userId;
  return search
    .select({
      key: ranked.key,
      match: {
        id: entryPhotos.id,
        photoKey: entryPhotos.photoKey,
        entryId: entryPhotos.entryId,
        canOpen: sql<boolean>`${publiclyVisibleEntry()}`.mapWith(Boolean),
        isPrivate: sql<boolean>`${notInArray(outfitEntries.audience, [
          ...strangerAudiences,
        ])}`.mapWith(Boolean),
        ...ownerColumns(ranked, owner),
      },
    })
    .from(ranked)
    .innerJoin(entryPhotos, eq(entryPhotos.id, ranked.photoId))
    .innerJoin(outfitEntries, eq(outfitEntries.id, entryPhotos.entryId))
    .where(isShown)
    .orderBy(...nearestFirst);
}

type KitRow = Awaited<ReturnType<typeof kitMatches>>[number]["match"];

/**
 * Garment photos within the distance of each subject, nearest first. A
 * garment photo is never shown to another runner, so it has no page to
 * link; the key is its card-sized copy, which the reviewer route serves
 * like any other. A garment with no photo has no fingerprint, so a NULL
 * distance, which no comparison keeps.
 */
function garmentMatches(db: Db, probes: readonly Probe[]) {
  const { search, ranked, isShown, nearestFirst } = nearestPerSubject(
    db,
    probes,
    { id: wardrobeItems.id, print: wardrobeItems.photoFingerprint },
  );
  const owner = wardrobeItems.userId;
  return search
    .select({
      key: ranked.key,
      match: {
        id: wardrobeItems.id,
        photoKey: sql<string>`${wardrobeItems.photoKey} || '/card.webp'`,
        ...ownerColumns(ranked, owner),
      },
    })
    .from(ranked)
    .innerJoin(wardrobeItems, eq(wardrobeItems.id, ranked.photoId))
    .where(isShown)
    .orderBy(...nearestFirst);
}

type GarmentRow = Awaited<ReturnType<typeof garmentMatches>>[number]["match"];
