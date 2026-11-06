import { Fragment } from "react";
import type { JSX } from "react";

import { STRAVA_CONSENT, stravaConsentText } from "../lib/copy";
import type { ConsentRun } from "../lib/copy";
import type { StravaOrigin } from "../lib/strava-origin";
import { StravaButton } from "./StravaButton";

/**
 * The consent Strava's API Policy §2.1 asks for, then Strava's own
 * Connect button (owner, 2026-10-18).
 *
 * **The only way to draw the button.** `ui/index.ts` exports this and not
 * `StravaButton`, so no screen can offer the OAuth redirect without the
 * disclosure in front of it: it is always visible, above the button, and
 * comes first in reading order. The button itself is unchanged — Strava's
 * asset, our link, the same redirect.
 *
 * Round 39 (#66, D-143): plain paragraphs at `text-small`, no glyph or
 * colour of their own, and the lead-ins ("What we collect:", "How:",
 * "Never:", "To stop:") run in, semibold at the paragraph's own size —
 * *"consent is read as sentences; four kickers over three paragraphs
 * would read as a form."* They inherit the surrounding text colour,
 * because T1 sits on the ground and P3's offer on ink.
 */
export function StravaConsent({
  from,
}: Readonly<{
  /**
  The screen the trip starts on, when it is not T1 — `StravaButton`'s.
  */
  from?: StravaOrigin | undefined;
}>): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <div data-slot="strava-consent" className="flex flex-col gap-2">
        {STRAVA_CONSENT.map((paragraph) => (
          <p key={stravaConsentText(paragraph)} className="m-0 text-small">
            {paragraph.map((run, index) => (
              <Fragment key={run.text}>
                {index === 0 ? undefined : " "}
                <Run run={run} />
              </Fragment>
            ))}
          </p>
        ))}
      </div>
      <StravaButton from={from} />
    </div>
  );
}

/**
 * One run: its lead-in in semibold, then the text. A `span`, not `strong`:
 * the weight is the board's typography, and `strong` is announced ("strong
 * … end of strong") around each lead-in, which breaks the consent into
 * fragments where round 39 wants it *"read as sentences"*.
 */
function Run({ run }: Readonly<{ run: ConsentRun }>): JSX.Element {
  if (run.lead === undefined) return <>{run.text}</>;
  return (
    <>
      <span data-part="consent-lead" className="font-semibold">
        {run.lead}
      </span>{" "}
      {run.text}
    </>
  );
}
