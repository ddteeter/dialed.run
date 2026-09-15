/**
 * The photo-screening eval's corpus (packet §1).
 *
 * **Local files, never committed.** These are photographs of people; the
 * repo is public, and a corpus of running photos in git is a worse idea
 * than the problem it solves. They live in `eval/photos/corpus/`, which is
 * gitignored, and this file describes what is expected to be there.
 *
 * **Chosen to be benign, and to be the benign cases most likely to trip a
 * classifier.** A corpus of flat-lays would pass everything and prove
 * nothing. The packet's worry is specific — "sports imagery triggers false
 * positives" — and the documented behaviour of `omni-moderation-latest`
 * narrows it further: revealing swimwear and underwear sit inside its
 * `sexual` category, and a sports bra or a shirtless summer run is exactly
 * the shape that resembles. So the spread that matters is:
 *
 * - **skin**, because that is the axis the false positive lives on:
 *   full winter layers, a singlet, a sports bra, a shirtless road run.
 * - **framing**, because a mirror selfie of a torso and a race photo of a
 *   whole body are different pictures of the same outfit.
 * - **subject**, because a flat-lay with no person in it should score near
 *   zero and is the control that says the pipeline is wired up at all.
 *
 * Every entry here is a photo a runner could legitimately post. **There are
 * no true positives in this corpus on purpose** — this eval measures the
 * false-positive rate, which is the number that decides the threshold. What
 * it cannot tell you is recall, and that limit is stated in the report
 * rather than left for a reader to assume.
 */
import { z } from "zod";

import { CORPUS } from "./corpus-data";
import { corpusEntrySchema } from "./corpus-entry";
import type { CorpusEntry } from "./corpus-entry";

/**
 * Parses at module load so a typo in the table is a startup error rather
 * than a confusing row in the report.
 */
export function validatedCorpus(): readonly CorpusEntry[] {
  return z.array(corpusEntrySchema).parse(CORPUS);
}
export {type CorpusEntry} from "./corpus-entry";