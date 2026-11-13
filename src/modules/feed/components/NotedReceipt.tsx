import type { JSX } from "react";

import { Mono, Spoken } from "../../../ui";

/**
 * Noted's sentence as drawn and as said: "… is now 1 of 1 in 38–46°" reads
 * "… in 38 to 46 degrees" (round 53 · 162.3). A sentence with no measure
 * in it is said as drawn.
 */
export interface NotedSentence {
  shown: string;
  said: string;
}

/**
 * A3's Noted block — the receipt for a logged verdict.
 *
 * Design round 20: *"Noted is a receipt, not a preview: it lands after Log
 * it in the submit's place, replacing share-toggle and submit; the verdict
 * row and chips stay, read-only, so the receipt is read against the
 * answer. No button in it — the tab bar is the exit."* The board marks the
 * region `data-state="after-log-it"`.
 *
 * It used to replace the whole screen with a centred "Noted", the
 * sentence and a Done button, so the runner read the receipt with the
 * answer it was a receipt *for* gone.
 *
 * The teal surface is round 16's "the teal 'noted' block is the payoff: it
 * proves the logging did something" — `bg-teal`, the teal T1 keeps for
 * surfaces, with `accent-ink` on it because text on an accent is always
 * ink, inverted block or not.
 *
 * Not a status region of its own: A3 has one (rule 08), and the form's
 * says `notedAnnouncement` when this lands, so the save is reported once,
 * with the sentence, rather than as "Verdict saved." and then again here.
 *
 * With no sentence — the verdict saved, and only the record's count failed
 * to come back — the receipt is "Noted" alone. The save is what it
 * vouches for, and that happened.
 */
export function NotedReceipt({
  sentence,
}: Readonly<{ sentence: NotedSentence | undefined }>): JSX.Element {
  return (
    <div
      data-slot="noted"
      className="flex flex-col gap-2 rounded-card bg-teal p-4 text-accent-ink"
    >
      <Mono step="xs">Noted</Mono>
      {sentence === undefined ? undefined : (
        <p className="m-0 text-body font-semibold">
          {/* A sentence with no measure in it is one text, not two. */}
          {sentence.shown === sentence.said ? (
            sentence.shown
          ) : (
            <Spoken {...sentence} />
          )}
        </p>
      )}
    </div>
  );
}

/**
 * What the screen's status region says when Noted lands: the receipt's
 * own words, so a reader hears what the eye reads, once — in their said
 * form, since a status region is heard and never seen.
 */
export function notedAnnouncement(sentence: NotedSentence | undefined): string {
  return sentence === undefined ? "Noted." : `Noted. ${sentence.said}`;
}
