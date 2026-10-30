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
  sql,
} from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

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
import { nearestOf } from "../../lib/sql/fingerprint-distance";
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
}

/**
 * Each subject's matches, by `subjectType:subjectId`.
 *
 * **One subject at a time, the subjects side by side.** A subject's
 * search needs its fingerprints first, and a batch cannot branch on its
 * own results, so each is a read and then one batch of its two searches.
 * A page has a handful of such rows, so that is a handful of parallel
 * round trips, against one batch whose results would have to be told
 * apart by index.
 */
export async function photoMatchesOf(
  db: Db,
  subjects: readonly OtherPhotosSubject[],
): Promise<Map<string, PhotoMatches>> {
  const answers = await Promise.all(
    subjects.map(async (subject) => {
      const own = await fingerprintsOf(db, subject);
      return [keyOf(subject), await search(db, subject, own)] as const;
    }),
  );
  return new Map(answers);
}

/**
 * One subject's search, or the answer that there was nothing to search
 * by. Its two reads go in one batch; neither needs the other's answer.
 */
async function search(
  db: Db,
  subject: OtherPhotosSubject,
  own: readonly string[],
): Promise<PhotoMatches> {
  if (own.length === 0) return { fingerprinted: false, matches: [] };
  const [kits, garments] = await db.batch([
    kitMatches(db, subject, own),
    garmentMatches(db, own),
  ]);
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
  };
}

function keyOf(subject: OtherPhotosSubject): string {
  return `${subject.subjectType}:${subject.subjectId}`;
}

/**
 * The fingerprints a subject is searched by: the photo's own, or every
 * photo's on the kit. A primary-key probe, or the
 * `entry_photos_idempotency` prefix.
 */
async function fingerprintsOf(
  db: Db,
  subject: OtherPhotosSubject,
): Promise<string[]> {
  const rows = await db
    .select({ fingerprint: entryPhotos.fingerprint })
    .from(entryPhotos)
    .where(
      and(
        OWN[subject.subjectType](subject.subjectId),
        isNotNull(entryPhotos.fingerprint),
      ),
    );
  // Parsed, not trusted: these are spelt into SQL (`lib/sql/fingerprint-distance`), and
  // only a fingerprint this repo wrote may be. A malformed one is a bug,
  // so it throws rather than quietly searching for nothing.
  return rows.map(({ fingerprint }) => fingerprintSchema.parse(fingerprint));
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
      isPrivate: sql<boolean>`${notInArray(outfitEntries.audience, [
        ...strangerAudiences,
      ])}`.mapWith(Boolean),
      // fallow-ignore-next-line code-duplication -- kitMatches and garmentMatches read two different photo tables against one fingerprint distance, already factored through nearestOf; kit rows carry an entry, visibility and audience a garment has no column for
      distance: sql<number>`${distance}`.mapWith(Number),
      // fallow-ignore-next-line code-duplication -- kitMatches and garmentMatches read two different photo tables against one fingerprint distance, already factored through nearestOf; kit rows carry an entry, visibility and audience a garment has no column for
      ownerId: outfitEntries.userId,
      handle: userProfiles.username,
    })
    .from(entryPhotos)
    .innerJoin(outfitEntries, eq(outfitEntries.id, entryPhotos.entryId))
    .leftJoin(userProfiles, eq(userProfiles.userId, outfitEntries.userId))
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
      // fallow-ignore-next-line code-duplication -- kitMatches and garmentMatches read two different photo tables against one fingerprint distance, already factored through nearestOf; kit rows carry an entry, visibility and audience a garment has no column for
      distance: sql<number>`${distance}`.mapWith(Number),
      ownerId: wardrobeItems.userId,
      handle: userProfiles.username,
    })
    .from(wardrobeItems)
    .leftJoin(userProfiles, eq(userProfiles.userId, wardrobeItems.userId))
    .where(lte(distance, FINGERPRINT_MATCH_DISTANCE))
    .orderBy(asc(distance), asc(wardrobeItems.id))
    .limit(PHOTO_MATCHES_LIMIT);
}
