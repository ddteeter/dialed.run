import type { JSX } from "react";

import { Mono } from "../../../ui";

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
 * `role="status"`, so the sentence is announced when it lands: the
 * control the runner pressed has just disappeared, and this is what took
 * its place.
 */
export function NotedReceipt({
  sentence,
}: Readonly<{ sentence: string }>): JSX.Element {
  return (
    <div
      role="status"
      data-slot="noted"
      className="flex flex-col gap-2 rounded-card bg-teal p-4 text-accent-ink"
    >
      <Mono step="xs">Noted</Mono>
      <p className="m-0 text-body font-semibold">{sentence}</p>
    </div>
  );
}
