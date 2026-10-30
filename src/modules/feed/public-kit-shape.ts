/**
 * What a public kit is (round 41 #86c, D-150), with no way to read one —
 * the half a route and a component need, apart from `public-kit.ts`,
 * which reaches `src/env` (the same split as `conditions-shape.ts`).
 *
 * **Every field is one D-150 lists**, already worded for display in the
 * runner's own units: a signed-out visitor has none of their own. There
 * is no field that could carry the run's start time, its coordinates or
 * route, a piece's flag or note, a Useful count or a follow, so the page
 * cannot render one: a type cannot be forgotten the way a check can.
 */
import { verdictLabel, type VerdictValue } from "../../lib/contracts";
import { NotFoundError } from "../../lib/errors";

/**
"6.2" and "mi": a number and the word that follows it.
*/
export interface PublicStat {
  readonly value: string;
  readonly unit: string;
}

/**
 * One piece of the kit: the closet's name for it ("Tracksmith Brighton
 * Base Layer"), the model alone for the card's one line ("Brighton Base
 * Layer", round 41 #86e: models without brands), what kind of piece it
 * is (the closet's TYPE chip, "L/S crew", else the category's word,
 * round 42 #90), and its product link when it has one the denylist
 * allows.
 */
export interface PublicPiece {
  readonly name: string;
  readonly model: string;
  readonly kind: string;
  readonly url?: string;
}

export interface PublicKit {
  readonly entryId: string;
  /**
  Without the "@".
  */
  readonly handle: string;
  /**
  The run's day where it was run, never a time: "Sat Oct 18".
  */
  readonly day: string;
  /**
   * Feels-like and sky — "38°" and "damp" — and whether they are Visual
   * Crossing's reading, which carries its credit (D-144). Absent for a
   * run with no conditions.
   */
  readonly conditions?: {
    readonly feelsLike: string;
    readonly sky: string;
    readonly isProviders: boolean;
  };
  readonly verdict?: VerdictValue;
  readonly distance: PublicStat;
  /**
  Moving time when the file had it, else the run's time.
  */
  readonly time: { readonly value: string; readonly isMoving: boolean };
  readonly pace?: PublicStat;
  readonly gain?: PublicStat;
  readonly caption?: string;
  /**
   * The kit's screened photos as the public bucket serves them (D-152,
   * design 161 step 8): absolute URLs on its own origin, in the kit's
   * order. Absent with none. Never on the card (D-151).
   */
  readonly photos?: readonly string[];
  readonly pieces: readonly PublicPiece[];
  /**
   * A digest of what the share card shows, so an edit gives the card a new
   * URL and a preview never shows the old one (design 161).
   */
  readonly cardVersion: string;
}

/**
 * The conditions and the verdict as the head says them: "38° damp, a bit
 * cold" — round 41's `{38° damp}, {cold}` in the app's own verdict words,
 * either half absent when the kit has none.
 */
function conditionsAndVerdict(kit: PublicKit): string {
  const conditions =
    kit.conditions === undefined
      ? []
      : [`${kit.conditions.feelsLike} ${kit.conditions.sky}`];
  const verdict = verdictLabel(kit.verdict);
  const verdictPart = verdict === undefined ? [] : [verdict.toLowerCase()];
  return [...conditions, ...verdictPart].join(", ");
}

/**
`@maya_runs · 38° damp, a bit cold` (round 41 #86c's og:title).
*/
export function publicKitTitle(kit: PublicKit): string {
  const said = conditionsAndVerdict(kit);
  return said === "" ? `@${kit.handle}` : `@${kit.handle} · ${said}`;
}

/**
 * The card's path, versioned (round 41 #86e): `/og/kit/<id>?v=<digest>`.
 */
export function publicKitCardPath(kit: PublicKit): string {
  return `/og/kit/${kit.entryId}?v=${kit.cardVersion}`;
}

/**
The most of the caption a preview may carry (round 41 #86c).
*/
const DESCRIPTION_MAX = 120;

type HeadMeta =
  | { name: string; content: string }
  | { property: string; content: string }
  | { title: string };

/**
 * The page's head. Not public — every reason alike — is `noindex` and
 * nothing else, so it keeps the site's default card and words (round 41
 * #86f). A public kit is `noindex` too (D-53), previews as its own card,
 * and carries no description beyond its caption's first 120 characters.
 * `origin` is the route's, because a preview fetches the image from
 * outside and needs it absolute.
 */
export function publicKitHead(
  kit: PublicKit | undefined,
  origin: string,
): { meta: HeadMeta[] } {
  const noindex = { name: "robots", content: "noindex" };
  if (kit === undefined) return { meta: [noindex] };
  const title = publicKitTitle(kit);
  const description =
    kit.caption === undefined
      ? []
      : [
          {
            property: "og:description",
            content: kit.caption.slice(0, DESCRIPTION_MAX),
          },
        ];
  return {
    meta: [
      noindex,
      { title },
      { property: "og:title", content: title },
      ...description,
      { property: "og:image", content: `${origin}${publicKitCardPath(kit)}` },
    ],
  };
}

/**
 * The route's loader answer: the kit, or the router's 404 — one not-found
 * for every reason a kit is not public (round 41 #86f), so the page, its
 * status and its head are the same whatever the reason. A real Error with
 * the marker the router duck-types on (`lib/errors`).
 */
export function kitOrNotFound(kit: PublicKit | undefined): PublicKit {
  if (kit === undefined) throw new NotFoundError("not a public kit");
  return kit;
}
