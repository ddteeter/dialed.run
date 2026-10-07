import { Link } from "@tanstack/react-router";
import type { JSX, RefObject } from "react";

import { FailureBand } from "../../ui";
import type { AuthBand, RefusalLink } from "./auth-copy";

/**
 * Where each refusal points, in the words round 28 #9 draws: the page
 * that fixes it.
 */
function RefusalLinkTo({ link }: Readonly<{ link: RefusalLink }>): JSX.Element {
  const className =
    "target inline-flex items-center font-bold text-ink underline underline-offset-4";
  return link === "request-access" ? (
    <Link to="/account/request-access" className={className}>
      Request access
    </Link>
  ) : (
    <Link to="/auth/signup" className={className}>
      Create an account
    </Link>
  );
}

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
 *   page its link names: Request access, or Create an account.
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
    >
      {band.link === undefined ? undefined : <RefusalLinkTo link={band.link} />}
    </FailureBand>
  );
}
