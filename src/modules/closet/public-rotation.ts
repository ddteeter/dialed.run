/**
 * A runner's rotation, for their public profile (round 41 #86d, D-151):
 * what `/@handle` shows of the closet when its runner turned on "Show my
 * closet".
 *
 * **Only what the closet already says about a piece**: its name, its
 * type, and — for shoes alone — the mileage the closet adds up for it.
 * Never how often it is worn, by week or by weekday (a routine), never
 * which runs it was on, and never a flag or a note, which live on the
 * entries, not here. The caller decides whether the rotation is shown at
 * all; this reads it.
 *
 * In `closet` because the type words and the mileage are the closet's:
 * the feed reads them through this module's index rather than a second
 * copy of either.
 */
import { desc, eq } from "drizzle-orm";

import { wardrobeItems } from "../../db/schema-core";
import type { DistanceUnit } from "../../lib/contracts";
import { wholeDistanceNumber } from "../../lib/contracts/measures";

import { computeUserPerformance } from "./service";
import { typeWordOf } from "./type-labels";

/**
 * One piece as the rotation lists it: the closet's name for it ("Pegasus
 * 41"), and beside it its mileage when it is a pair of shoes ("412 mi"),
 * else its type ("Tights").
 */
export interface RotationPiece {
  readonly name: string;
  readonly detail: string;
}

/**
 * IN USE (everything not retired but shoes), SHOES (the pairs not
 * retired) and RETIRED (everything retired, shoes with their mileage),
 * newest first in each.
 */
export interface PublicRotation {
  readonly inUse: readonly RotationPiece[];
  readonly shoes: readonly RotationPiece[];
  readonly retired: readonly RotationPiece[];
}

type Piece = Pick<
  typeof wardrobeItems.$inferSelect,
  "id" | "name" | "category" | "type" | "retired"
>;

export async function publicRotation(
  database: Parameters<typeof computeUserPerformance>[0],
  userId: string,
  unit: DistanceUnit,
): Promise<PublicRotation> {
  const [pieces, performance] = await Promise.all([
    database
      .select({
        id: wardrobeItems.id,
        name: wardrobeItems.name,
        category: wardrobeItems.category,
        type: wardrobeItems.type,
        retired: wardrobeItems.retired,
      })
      .from(wardrobeItems)
      .where(eq(wardrobeItems.userId, userId))
      .orderBy(desc(wardrobeItems.createdAt)),
    computeUserPerformance(database, userId),
  ]);
  const listed = (piece: Piece): RotationPiece => ({
    name: piece.name,
    detail: isShoes(piece)
      ? `${wholeDistanceNumber(performance.get(piece.id)?.summary.mileageM ?? 0, unit)} ${unit}`
      : typeWordOf(piece.category, piece.type),
  });
  return {
    inUse: pieces
      .filter((piece) => !piece.retired && !isShoes(piece))
      .map((piece) => listed(piece)),
    shoes: pieces
      .filter((piece) => !piece.retired && isShoes(piece))
      .map((piece) => listed(piece)),
    retired: pieces.filter((piece) => piece.retired).map((piece) => listed(piece)),
  };
}

function isShoes(piece: Piece): boolean {
  return piece.category === "shoes";
}

