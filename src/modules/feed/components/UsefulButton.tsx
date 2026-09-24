import { useEffect } from "react";

import {
  ControlFailureBand,
  Digits,
  inFlight,
  Mono,
  PendingLabel,
} from "../../../ui";
import { useUsefulReaction } from "./useful-reaction";
import type { UsefulReactionInput } from "./useful-reaction";

/**
 * Useful, as the E1 card and D both draw it (round 22): `♡ 11 USEFUL` in
 * mono, `♥` and pink once the viewer has marked it, and `♡ USEFUL` — no
 * zero — when nobody has.
 *
 * **Round 23, item 9**: it waits for the server behind `[ Noting ]`, the
 * count changes on success only, and a failure is the control band
 * directly under it, naming the state still true. The one sentence goes
 * to the screen's single status region through `onStatus`, because a feed
 * of twenty cards is still one screen with one region (Accessibility
 * Contract rule 08).
 *
 * The heart is text, as the frames draw it, and hidden from a screen
 * reader: `aria-pressed` already says whether it is marked, and "black
 * heart suit" says nothing.
 */
export function UsefulButton({
  onStatus,
  ...reaction
}: Readonly<
  UsefulReactionInput & {
    onStatus: (status: string) => void;
  }
>) {
  const { useful, markUseful } = useUsefulReaction(reaction);
  const { status } = markUseful;
  useEffect(() => {
    onStatus(status);
  }, [status, onStatus]);

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        data-part="reactions"
        aria-pressed={useful.reacted}
        {...inFlight(markUseful.pending)}
        onClick={() => {
          void markUseful.run();
        }}
        className={`target flex cursor-pointer items-center self-start border-none bg-transparent p-0 ${
          useful.reacted ? "font-semibold text-cold-text" : "text-quiet"
        }`}
      >
        <Mono step="sm">
          <PendingLabel
            pending={markUseful.pending}
            pendingLabel="Noting"
            label={
              <span className="flex gap-1">
                <span aria-hidden="true">{useful.reacted ? "♥" : "♡"}</span>
                {useful.count === 0 ? undefined : (
                  <Digits value={useful.count} />
                )}
                <span>Useful</span>
              </span>
            }
          />
        </Mono>
      </button>
      {/* Directly under the control that failed, full content width —
          never beside it, which is too narrow for a sentence and a button
          (§4a). */}
      <ControlFailureBand
        failure={markUseful.failure}
        onRetry={markUseful.retry}
        retryRef={markUseful.retryRef}
      />
    </div>
  );
}
