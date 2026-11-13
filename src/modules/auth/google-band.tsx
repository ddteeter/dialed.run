import type { JSX, RefObject } from "react";

import { FailureBand } from "../../ui";
import type { AuthBand } from "./auth-copy";

/**
 * Every band Google's button owns, directly under it (round 29 #13; Au6 as
 * round 33 redrew it; register R-128): a **control failure**, not the
 * form's failure band, because the button is a control and the form above
 * it did not fail. The frame is §4a's, `ui/FailureBand` — kicker, sentence,
 * a 1px ink rule, no fill, no hue (round 29 #1) — under Au6's own part name,
 * and what ends it depends on the band:
 *
 * - **The fault** ("Google didn't answer"): Try again, which repeats the
 *   attempt, and is the only filled thing in the band.
 * - **A refusal** (`retry: false`, round 28 #9): no Try again, because
 *   pressing again cannot fix it. The fix is the code field above, or the
 *   page's own line under the band (Round 55 · 177: a band never repeats a
 *   line the page already shows, so it names no page itself).
 *
 * **Not a second `role="status"`.** The board marks the band as one, but
 * the Accessibility Contract (rule 08) allows one status region per
 * screen, and the contract outranks the board: the page's own region
 * already speaks the band's words (`auth-copy`'s `authStatus`), so the
 * band is announced once, through it.
 */
export function GoogleBand({
  band,
  onRetry,
  retryRef,
}: Readonly<{
  band: AuthBand;
  onRetry: () => void;
  retryRef?: RefObject<HTMLButtonElement | null> | undefined;
}>): JSX.Element {
  const isRefusal = band.retry === false;
  return (
    <FailureBand
      part="control-failure"
      state={isRefusal ? "refused" : "google-failed"}
      kicker={band.kicker}
      message={band.message}
      onRetry={isRefusal ? undefined : onRetry}
      retryRef={retryRef}
    />
  );
}
