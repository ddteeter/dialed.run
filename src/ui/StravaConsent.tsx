import type { JSX } from "react";

import { STRAVA_CONSENT } from "../lib/copy";
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
 * Undesigned (design-deltas, open queue): plain paragraphs in the body
 * face, no glyph or colour of their own. They inherit the surrounding
 * text colour, because T1 sits on the ground and O3's offer on ink.
 */
export function StravaConsent(): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <div data-slot="strava-consent" className="flex flex-col gap-2">
        {STRAVA_CONSENT.map((paragraph) => (
          <p key={paragraph} className="m-0 text-small">
            {paragraph}
          </p>
        ))}
      </div>
      <StravaButton />
    </div>
  );
}
