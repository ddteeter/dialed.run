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
import { and, asc, eq, isNotNull, lte, not, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

import {
  entryPhotos,
  outfitEntries,
  wardrobeItems,
} from "../../db/schema-core";
import {
  FINGERPRINT_MATCH_DISTANCE,
  HEX_DIGITS,
  digitDistances,
  fingerprintSchema,
} from "../../lib/photo-fingerprint";
import type { OtherPhotosSubject } from "./other-photos";
import { publiclyVisibleEntry } from "./visibility";

type Db = ReturnType<typeof drizzle>;

/**
 * How many matches of each kind a row lists, nearest first. A bound for
 * the page's sake, as `OTHER_PHOTOS_LIMIT` is; a picture copied more
 * often than this is one an operator has already found.
 */
export const PHOTO_MATCHES_LIMIT = 12;

/**
 * One matching photo. `photoKey` is the object `/safety/review-photo/`
 * serves; `distance` is how many bits apart it is, 0 for the same
 * picture. A kit photo carries its kit, for the link to its page; a
 * garment photo is never shown to another runner, so it has no page an
 * operator can open.
 */
export type PhotoMatch = Readonly<
  { id: string; photoKey: string; distance: number } & (
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
}

/**
Each subject's matches, by `subjectType:subjectId`.
*/
export async function photoMatchesOf(
  db: Db,
  subjects: readonly OtherPhotosSubject[],
): Promise<Map<string, PhotoMatches>> {
  const fingerprints = await subjectFingerprints(db, subjects);
  const found = await search(
    db,
    subjects.flatMap((subject, index) => {
      const own = fingerprints[index] ?? [];
      return own.length === 0 ? [] : [{ subject, own }];
    }),
  );
  return new Map(
    subjects.map((subject) => {
      const matches = found.get(keyOf(subject));
      return [
        keyOf(subject),
        { fingerprinted: matches !== undefined, matches: matches ?? [] },
      ];
    }),
  );
}

/**
 * The matches of every subject that has fingerprints, by its key. Two
 * batches rather than one, so each keeps its own row type; neither needs
 * the other's answer.
 */
async function search(
  db: Db,
  searched: readonly { subject: OtherPhotosSubject; own: string[] }[],
): Promise<Map<string, PhotoMatch[]>> {
  const [first, ...rest] = searched.map(
    ({ subject, own }) =>
      [kitMatches(db, subject, own), garmentMatches(db, own)] as const,
  );
  if (first === undefined) return new Map();
  const [kits, garments] = await Promise.all([
    db.batch([first[0], ...rest.map(([kit]) => kit)]),
    db.batch([first[1], ...rest.map(([, garment]) => garment)]),
  ]);
  return new Map(
    searched.map(({ subject }, index) => [
      keyOf(subject),
      [
        ...(kits[index] ?? []).map((row) => ({ kind: "kit" as const, ...row })),
        ...(garments[index] ?? []).map((row) => ({
          kind: "garment" as const,
          canOpen: false as const,
          ...row,
        })),
      ],
    ]),
  );
}

function keyOf(subject: OtherPhotosSubject): string {
  return `${subject.subjectType}:${subject.subjectId}`;
}

/**
 * The fingerprints a subject is searched by, in subject order: the
 * photo's own, or every photo's on the kit. One batch, each read a
 * primary-key probe or the `entry_photos_idempotency` prefix.
 */
async function subjectFingerprints(
  db: Db,
  subjects: readonly OtherPhotosSubject[],
): Promise<string[][]> {
  const [first, ...rest] = subjects.map((subject) =>
    db
      .select({ fingerprint: entryPhotos.fingerprint })
      .from(entryPhotos)
      .where(
        and(
          OWN[subject.subjectType](subject.subjectId),
          isNotNull(entryPhotos.fingerprint),
        ),
      ),
  );
  if (first === undefined) return [];
  const read = await db.batch([first, ...rest]);
  // Parsed, not trusted: these are spelt into SQL (`distanceSql`), and
  // only a fingerprint this repo wrote may be. A malformed one is a bug,
  // so it throws rather than quietly searching for nothing.
  return read.map((rows) =>
    rows.map(({ fingerprint }) => fingerprintSchema.parse(fingerprint)),
  );
}

/**
The subject's own photos: the one photo, or every photo on the kit.
*/
const OWN = {
  photo: (subjectId: string) => eq(entryPhotos.id, subjectId),
  entry: (subjectId: string) => eq(entryPhotos.entryId, subjectId),
} as const;

/**
 * Kit photos within the distance, nearest first, the subject's own left
 * out — it is on the row already. Private kits are not left out (D-142):
 * a copy is no less a copy for being posted privately.
 */
function kitMatches(
  db: Db,
  subject: OtherPhotosSubject,
  own: readonly string[],
) {
  const distance = nearestOf(entryPhotos.fingerprint, own);
  const notOwn = not(OWN[subject.subjectType](subject.subjectId));
  return db
    .select({
      id: entryPhotos.id,
      photoKey: entryPhotos.photoKey,
      entryId: entryPhotos.entryId,
      canOpen: sql<boolean>`${publiclyVisibleEntry()}`.mapWith(Boolean),
      distance: sql<number>`${distance}`.mapWith(Number),
    })
    .from(entryPhotos)
    .innerJoin(outfitEntries, eq(outfitEntries.id, entryPhotos.entryId))
    .where(
      // No `IS NOT NULL`: a photo with no fingerprint has a NULL
      // distance, which no comparison keeps.
      and(lte(distance, FINGERPRINT_MATCH_DISTANCE), notOwn),
    )
    .orderBy(asc(distance), asc(entryPhotos.id))
    .limit(PHOTO_MATCHES_LIMIT);
}

/**
 * Garment photos within the distance, nearest first. A garment photo is
 * never shown to another runner, so it has no page to link; the key is
 * its card-sized copy, which the reviewer route serves like any other.
 * A garment with no photo has no fingerprint, so a NULL distance, which
 * no comparison keeps.
 */
function garmentMatches(db: Db, own: readonly string[]) {
  const distance = nearestOf(wardrobeItems.photoFingerprint, own);
  return db
    .select({
      id: wardrobeItems.id,
      photoKey: sql<string>`${wardrobeItems.photoKey} || '/card.webp'`,
      distance: sql<number>`${distance}`.mapWith(Number),
    })
    .from(wardrobeItems)
    .where(lte(distance, FINGERPRINT_MATCH_DISTANCE))
    .orderBy(asc(distance), asc(wardrobeItems.id))
    .limit(PHOTO_MATCHES_LIMIT);
}

/**
 * The distance from a stored fingerprint to the nearest of the subject's.
 *
 * `min` with one argument is SQLite's aggregate, which would fold every
 * row into one; the trailing 64 — more bits than a fingerprint has, so
 * never the answer — keeps it the scalar `min` however many there are.
 */
function nearestOf(column: SQLiteColumn, own: readonly string[]): SQL {
  const each = own.map((fingerprint) => distanceSql(column, fingerprint));
  return sql`min(${sql.join(each, COMMA)}, 64)`;
}

const COMMA = sql`, `;
const PLUS = sql` + `;

/**
 * A string literal, inlined. Only ever given digits (see `distanceSql`),
 * so there is no quote in it to escape.
 */
function quoted(digits: string): SQL {
  return sql.raw(`'${digits}'`);
}

const HEX = quoted(HEX_DIGITS);

/**
 * The bits between `column` and `fingerprint`, as SQL: per digit, the
 * stored digit's entry in that digit's `digitDistances` string. `instr`
 * finds the stored digit's place in `HEX_DIGITS`, 1-based as `substr`
 * counts.
 *
 * **Inlined, not bound**, because D1 allows 100 bound parameters a query
 * and a four-photo kit would need 192. What is inlined is digits only:
 * `fingerprint` was parsed by `fingerprintSchema` on the way in,
 * `digitDistances` returns 16 of 0–4, and `HEX_DIGITS` is a constant.
 */
function distanceSql(column: SQLiteColumn, fingerprint: string): SQL {
  const digits = Array.from({ length: fingerprint.length }, (_, index) => {
    const lookup = quoted(digitDistances(fingerprint.charAt(index)));
    const place = sql.raw(String(index + 1));
    return sql`substr(${lookup}, instr(${HEX}, substr(${column}, ${place}, 1)), 1)`;
  });
  return sql`(${sql.join(digits, PLUS)})`;
}
