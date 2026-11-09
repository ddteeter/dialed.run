/**
 * A kit as an operator sees it, whatever its audience or state (R-154,
 * #388; design 188): the page Review's other photos and matches, and a
 * removal request's "Open the kit", link to. `/feed/entry/$entryId` asks
 * whether the viewer may see a kit, the question every runner is asked, so a private
 * kit or one hidden pending review sends an operator away; this read asks
 * only whether they are an operator.
 *
 * **Everything on the kit, and nothing the Desk does not need.** Every
 * photo, whatever its screening status, since a copy may be the one held;
 * each is served by `/desk/review-photo/`, which requires an admin too.
 * The garments by name, and the verdict and caption a runner wrote. Not
 * the run's conditions, Useful counts or tags: none of them decides a
 * report.
 */
import { asc, eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/d1";

import {
  entryPhotos,
  outfitEntries,
  runs,
  userProfiles,
} from "../../db/schema-core";
import type { Audience } from "../../lib/contracts";
import { requireAdmin } from "./admin";
import { kitPiecesSelect } from "./kit-pieces";

type Db = ReturnType<typeof drizzle>;

/**
What the kit's band names: whose it is, who may see it, and where review left it.
*/
export interface DeskKit {
  readonly id: string;
  readonly runnerId: string;
  readonly handle: string | undefined;
  readonly audience: Audience;
  readonly moderationStatus: "ok" | "hidden_pending_review" | "removed";
  readonly verdict: number | undefined;
  readonly caption: string | undefined;
  readonly createdAt: number;
  /**
  The run it was worn on; nothing for a run since deleted.
  */
  readonly run: Readonly<{ title: string; startedAt: number }> | undefined;
  readonly photos: readonly DeskKitPhoto[];
  readonly garments: readonly DeskKitGarment[];
}

/**
 * One photo on the kit: its id, which the takedown form takes, its key,
 * which `/desk/review-photo/` serves, and how screening left it.
 */
export interface DeskKitPhoto {
  readonly id: string;
  readonly photoKey: string;
  readonly screenStatus: string;
}

/**
A garment worn, by the name its runner gave it.
*/
export interface DeskKitGarment {
  readonly id: string;
  readonly name: string;
  readonly brand: string | undefined;
  readonly category: string;
}

/**
 * The kit, for an operator, or nothing when no kit has that id. Refuses
 * anyone who is not one (`requireAdmin`) before it reads. One batch: the
 * kit with its run and runner's handle, its photos in order, its garments
 * in the order they were put on it (`kitPiecesSelect`).
 */
export async function deskKitFor(
  db: Db,
  viewerId: string,
  entryId: string,
): Promise<DeskKit | undefined> {
  requireAdmin(viewerId);
  const [kits, photos, garments] = await db.batch([
    db
      .select({
        id: outfitEntries.id,
        runnerId: outfitEntries.userId,
        handle: userProfiles.username,
        // fallow-ignore-next-line code-duplication -- fallow 3.34 matches drizzle's select/from/join/where grammar across tables; deskKitFor is the one read of a kit for the Desk, and its pieces already come from kitPiecesSelect, which feed/public-kit.ts shares
        audience: outfitEntries.audience,
        moderationStatus: outfitEntries.moderationStatus,
        verdict: outfitEntries.verdict,
        caption: outfitEntries.caption,
        createdAt: outfitEntries.createdAt,
        // Drizzle answers a left join's object with none of its columns
        // as null: one check for a run since deleted.
        run: { title: runs.title, startedAt: runs.startedAt },
        // fallow-ignore-next-line code-duplication -- fallow 3.34 matches drizzle's select/from/join/where grammar across tables; deskKitFor is the one read of a kit for the Desk, and its pieces already come from kitPiecesSelect, which feed/public-kit.ts shares
      })
      .from(outfitEntries)
      .leftJoin(runs, eq(runs.id, outfitEntries.runId))
      .leftJoin(userProfiles, eq(userProfiles.userId, outfitEntries.userId))
      .where(eq(outfitEntries.id, entryId)),
    db
      .select({
        // fallow-ignore-next-line code-duplication -- fallow 3.34 matches drizzle's select/from/join/where grammar across tables; deskKitFor is the one read of a kit for the Desk, and its pieces already come from kitPiecesSelect, which feed/public-kit.ts shares
        id: entryPhotos.id,
        photoKey: entryPhotos.photoKey,
        screenStatus: entryPhotos.screenStatus,
      })
      .from(entryPhotos)
      .where(eq(entryPhotos.entryId, entryId))
      .orderBy(asc(entryPhotos.position)),
    kitPiecesSelect(db, entryId),
  ]);
  const [kit] = kits;
  if (kit === undefined) return undefined;
  return {
    ...kit,
    handle: kit.handle ?? undefined,
    verdict: kit.verdict ?? undefined,
    caption: kit.caption ?? undefined,
    run: kit.run ?? undefined,
    photos,
    garments: garments.map(({ id, name, brand, category }) => ({
      id,
      name,
      brand: brand ?? undefined,
      category,
    })),
  };
}
