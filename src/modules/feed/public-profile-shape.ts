/**
 * What a public profile is (round 41 #86d, D-150), with no way to read one
 * — the half the route and the component need, apart from
 * `public-profile.ts`, which reaches `src/env` (as `public-kit-shape.ts`
 * is to `public-kit.ts`).
 *
 * **Every field is one #86d draws.** A kit row has the day, the
 * conditions, the distance and the verdict, and links to its own `/k`
 * page; the rotation has names, types and shoe mileage. There is no field
 * for a run's time, its place, a piece's flag or note, a follow or a
 * count of anything but the kits themselves.
 */
import type { PublicRotation } from "../closet";
import { NotFoundError } from "../../lib/errors";

import type { PublicKit } from "./public-kit-shape";

/**
 * One kit as the profile lists it: a tile, its conditions, its day and
 * distance, and its verdict. `photo` is the kit's first photo as the
 * public bucket serves it (D-152, design 163 step 8), the one `/k` shows
 * first; absent with none, when the tile is --tint.
 */
export type PublicKitRow = Pick<
  PublicKit,
  "entryId" | "day" | "conditions" | "verdict" | "distance"
> & { readonly photo?: string };

export interface PublicProfile {
  /**
  Without the "@", as the runner holds it now.
  */
  readonly handle: string;
  /**
  Every public kit, however many the page lists.
  */
  readonly kitCount: number;
  /**
  Newest first: the first three, or all of them under "Show N more".
  */
  readonly kits: readonly PublicKitRow[];
  /**
  Only while the runner shows their closet ("Show my closet").
  */
  readonly rotation?: PublicRotation;
}

/**
 * How many kits the page lists before "Show {N} more" (round 41 #86d:
 * "three rows, then Show N more").
 */
export const FIRST_KITS = 3;

/**
"Show {N} more", or nothing when the page already lists every kit.
*/
export function moreKits(profile: PublicProfile): number {
  return profile.kitCount - profile.kits.length;
}

type HeadMeta = { name: string; content: string } | { title: string };

/**
 * The page's head. `noindex` for both pages (D-53), and nothing else for
 * a profile that is not public, so it names no handle (#86f). A public
 * profile adds its handle as the tab's title and keeps the site's default
 * card (#86e): only a kit previews as its own.
 */
export function publicProfileHead(profile: PublicProfile | undefined): {
  meta: HeadMeta[];
} {
  const noindex = { name: "robots", content: "noindex" };
  if (profile === undefined) return { meta: [noindex] };
  return { meta: [noindex, { title: `@${profile.handle}` }] };
}

/**
 * The route's loader answer: the profile, or the router's 404 — one
 * not-found for every reason a profile is not public (round 41 #86f).
 */
export function profileOrNotFound(
  profile: PublicProfile | undefined,
): PublicProfile {
  if (profile === undefined) throw new NotFoundError("not a public profile");
  return profile;
}
