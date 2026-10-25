import { useState } from "react";

import { effortSchema } from "../../../lib/contracts";
import type { Effort } from "../../../lib/contracts";
import { Mono } from "../../../ui";
import type { RunEffort } from "../entries";
import { ChipToggle } from "./VerdictChips";

/**
 * A3's effort, as design G5 rules it: the four efforts, the watch's
 * prefill drawn selected exactly like a runner's own pick, and saved if
 * left alone.
 *
 * `pickedByRunner` is what the save sends: the run already holds the
 * watch's effort, so only a tap has anything to write, and the tap is what
 * makes the effort the runner's (`effort_source = runner`). Any tap counts,
 * even on the chip already chosen. The prefill never comes back.
 */
export function useEffortPick(initial: RunEffort | undefined) {
  const [effort, setEffort] = useState(initial?.chosen);
  const [pickedByRunner, setPickedByRunner] = useState(false);
  return {
    effort,
    pickedByRunner,
    // The watch's rating, while the watch's pick still stands.
    watchRpe: pickedByRunner ? undefined : initial?.watchRpe,
    pick: (next: Effort) => {
      setEffort(next);
      setPickedByRunner(true);
    },
  };
}

const EFFORT_WORDS: Readonly<Record<Effort, string>> = {
  easy: "Easy",
  steady: "Steady",
  workout: "Workout",
  race: "Race",
};

const LABEL_ID = "verdict-effort";
const SOURCE_ID = "verdict-effort-source";

/**
 * The row: EFFORT, and beside it where a prefill came from — FROM YOUR
 * WATCH · RATED {n} OF 10, set in caps by the mono step — which is the
 * only thing that marks it as a suggestion (no new colour or style; the
 * words carry it). Spoken "Effort, Steady, from your watch, rated 6 of
 * 10": the mono line is for the eye, and the description says it in words.
 */
export function EffortField({
  effort,
  watchRpe,
  readOnly,
  onPick,
}: Readonly<{
  effort: Effort | undefined;
  watchRpe: number | undefined;
  readOnly: boolean;
  onPick: (effort: Effort) => void;
}>) {
  return (
    <div
      role="group"
      aria-labelledby={LABEL_ID}
      aria-describedby={watchRpe === undefined ? undefined : SOURCE_ID}
      data-slot="effort"
      className="flex flex-col gap-2 border-t border-hairline pt-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <span id={LABEL_ID}>
          <Mono step="xs" className="text-muted">
            Effort
          </Mono>
        </span>
        {watchRpe === undefined ? undefined : (
          <>
            <span aria-hidden="true">
              <Mono step="xs" className="text-muted">
                From your watch · rated {watchRpe} of 10
              </Mono>
            </span>
            <span id={SOURCE_ID} className="sr-only">
              From your watch, rated {watchRpe} of 10
            </span>
          </>
        )}
      </div>
      <div className="grid grid-cols-4 gap-2">
        {effortSchema.options.map((option) => (
          <ChipToggle
            key={option}
            pick
            pressed={effort === option}
            readOnly={readOnly}
            onToggle={() => {
              onPick(option);
            }}
          >
            {EFFORT_WORDS[option]}
          </ChipToggle>
        ))}
      </div>
    </div>
  );
}
