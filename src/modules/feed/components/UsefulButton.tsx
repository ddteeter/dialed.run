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
 * **It waits for a confirmed address** (round 26 #11): it draws at full
 * strength for everyone and every press asks the server, whose refusal
 * opens the root's "Confirm your email first" sheet (D-113).
 *
 * The heart is text, as the frames draw it, and hidden from a screen
 * reader: `aria-pressed` already says whether it is marked, and "black
 * heart suit" says nothing.
 *
 * **The name is what is drawn, then whose run** (`whose`): "11 Useful,
 * @trail_7's run". A feed is twenty of these, and "11 Useful" twenty
 * times says nothing of which card a reader is on. The drawn words lead
 * the name, count included, because a name that starts anywhere else
 * fails WCAG 2.5.3 for a speech user who says what they see (axe's
 * `label-content-name-mismatch` caught "Useful, …" under a drawn "1
 * Useful").
 */
export function UsefulButton({
  onStatus,
  whose,
  ...reaction
}: Readonly<
  UsefulReactionInput & {
    onStatus: (status: string) => void;
    /**
    Whose run, said after the drawn words ("@trail_7's run"): a card in a
    list needs it, a screen about one entry does not.
    */
    whose?: string | undefined;
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
        // A label rather than sr-only text inside, so the drawn words stay
        // the only text on screen and a rolling count's leaving digit is
        // never in the name; dropped while pending, when the name is the
        // drawn `[ Noting ]`.
        aria-label={
          markUseful.pending ? undefined : usefulName(useful.count, whose)
        }
        {...inFlight(markUseful.pending)}
        onClick={() => {
          void markUseful.run(!useful.reacted);
        }}
        // R55·205: the 44 target grows into the post's padding and the gap
        // above, so the drawn words keep the card's rhythm.
        className={`target -my-3 flex cursor-pointer items-center self-start border-none bg-transparent p-0 ${
          useful.reacted ? "font-semibold text-cold-text" : "text-quiet"
        }`}
      >
        <Mono step="sm">
          {/* Flush to the card's left edge, so "[ Noting ]" starts where
              the heart does rather than centring under it (E1-07, N2-09). */}
          <PendingLabel
            align="start"
            pending={markUseful.pending}
            pendingLabel="Noting"
            label={
              <span className="flex gap-1">
                {/* One glyph, filled or outlined (E2-08). Neither heart is
                    in Plex Mono, so each fell back to whichever system face
                    had it, and "♡" came out smaller and lighter than "♥".
                    The outline is the same "♥" with a 1px stroke and no
                    fill, so the two are one size, on one line. */}
                <span
                  aria-hidden="true"
                  className={useful.reacted ? undefined : HEART_OUTLINE_CLASS}
                >
                  ♥
                </span>
                {useful.count === 0 ? undefined : (
                  <Digits value={useful.count} />
                )}
                {/* The gap draws the space; this one is for the text. A
                    flex container does not render it, but without it the
                    button's text is "11Useful", one word, and not in the
                    name "11 Useful, …" (axe's label-content-name-mismatch). */}{" "}
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

const HEART_OUTLINE_CLASS =
  "[-webkit-text-fill-color:transparent] [-webkit-text-stroke:1px_currentColor]";

/**
 * The words the button draws, heart aside — "11 Useful", and "Useful"
 * with no zero — then whose run, where there is one to say.
 */
function usefulName(count: number, whose: string | undefined): string {
  const drawn = count === 0 ? "Useful" : `${String(count)} Useful`;
  return whose === undefined ? drawn : `${drawn}, ${whose}`;
}
