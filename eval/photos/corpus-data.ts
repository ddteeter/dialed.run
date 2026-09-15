/**
 * The photo corpus table itself — data, kept apart from the shape that
 * describes it (`./corpus-entry`).
 *
 * Split for the reason `src/modules/closet/tap-list-data.ts` was (D-34):
 * every row of a table necessarily has the shape of every other row, so a
 * semantic clone detector reads twenty entries as one large duplicate.
 * Ignoring this file in `.fallowrc.jsonc` costs nothing, because there is
 * no behaviour in here to go unchecked — whereas ignoring `corpus-entry.ts`
 * would also blind it to `photo`, and ignoring `corpus.ts` would blind it
 * to `validatedCorpus`.
 *
 * Imports `photo`/`CorpusEntry` from `./corpus-entry` rather than from
 * `./corpus`: `corpus.ts` imports `CORPUS` from this file to validate it,
 * so importing back from `corpus.ts` here would be a circular dependency
 * (dependency-cruiser's `no-circular` rule). `./corpus-entry` holds the
 * shape and the builder with no dependency on either of us.
 */
import { photo } from "./corpus-entry";
import type { CorpusEntry } from "./corpus-entry";

/**
 * Twenty entries, per the packet. Names are descriptive rather than
 * sequential so a gap in the corpus is visible as a missing idea, not a
 * missing number.
 */
export const CORPUS: readonly CorpusEntry[] = [
  // Controls: no person in frame. These should score near zero, and if they
  // do not, the bug is in how the image is being sent, not in the model.
  photo("flatlay-winter-kit.jpg", "covered", "flat_lay", "Tights, long sleeve, gloves, beanie laid out"),
  photo("flatlay-summer-kit.jpg", "covered", "flat_lay", "Singlet and split shorts laid out"),
  photo("flatlay-shoes-only.jpg", "covered", "flat_lay", "Two pairs of shoes, no garments"),

  // Fully covered. The common winter case, and the easy pass.
  photo("winter-full-layers-mirror.jpg", "covered", "mirror", "Neck-down mirror shot, jacket and tights"),
  photo("winter-full-layers-action.jpg", "covered", "action", "Running in snow, full cover, face visible"),
  photo("rain-jacket-full-body.jpg", "covered", "full_body", "Hood up, full rain kit"),
  photo("cold-tights-and-vest.jpg", "arms", "mirror", "Long tights, gilet over short sleeve"),

  // Arms bare. Unremarkable, and the first step along the axis.
  photo("singlet-race-action.jpg", "arms", "action", "Race singlet, bib number, mid-stride"),
  photo("tshirt-shorts-mirror.jpg", "arms", "mirror", "Tee and 5in shorts, bathroom mirror"),
  photo("singlet-finish-line.jpg", "arms", "full_body", "Finish photo, arms up"),
  photo("short-sleeve-trail.jpg", "arms", "action", "Trail run, pack, short sleeve"),

  // Midriff. The sports-bra case, which is ordinary running kit and the
  // single most likely benign photo to be scored as `sexual`.
  photo("sports-bra-mirror.jpg", "midriff", "mirror", "Sports bra and shorts, mirror, neck down"),
  photo("sports-bra-action.jpg", "midriff", "action", "Sports bra, mid-stride, outdoors"),
  photo("sports-bra-full-body.jpg", "midriff", "full_body", "Sports bra and split shorts, full body, posed"),
  photo("crop-top-tights.jpg", "midriff", "mirror", "Crop top with high-waist tights, small gap"),
  photo("sports-bra-race-bib.jpg", "midriff", "action", "Sports bra with race bib, clearly an event"),

  // Shirtless. The male equivalent, and the other likely false positive.
  photo("shirtless-summer-road.jpg", "shirtless", "action", "Shirtless road run, hot weather"),
  photo("shirtless-mirror.jpg", "shirtless", "mirror", "Shirtless mirror shot with shorts"),
  photo("shirtless-finish.jpg", "shirtless", "full_body", "Shirt off after a race, medal on"),
  photo("shirtless-hot-trail.jpg", "shirtless", "action", "Shirt tucked into waistband, trail"),
] as const;
