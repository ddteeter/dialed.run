import { Link } from "@tanstack/react-router";
import type { JSX } from "react";
import { useState } from "react";

import { PendingLabel } from "./form";
import { Mono } from "./Mono";

/**
 * Strava's official "Connect with Strava" button (task 127, STR-7; design
 * round 26, item 21), for T1 and O3 — which is why it lives here: two
 * modules draw it, and neither may reach into the other.
 *
 * **The button is the link.** Strava's orange asset, 48 tall and
 * unaltered, used as the image file (`public/strava/`, with Strava's terms
 * beside it), wrapped in our `<a>` — whose accessible name is the image's
 * alt, "Connect with Strava". Focus is rule 06 in the square style, which
 * `ui/a11y.css` gives every link. It leaves through `/runs/strava-connect`,
 * which mints the OAuth nonce and redirects to Strava's `/oauth/authorize`;
 * `reloadDocument`, because that is a server redirect and not a screen.
 *
 * **While OAuth is in flight our brackets show beside it** — `[ Connecting
 * ]` — and the asset never changes: we never swap Strava's label, and
 * there is no "Powered by Strava" mark because we show no Strava data.
 *
 * `data-part="strava-button"` is the one palette exemption besides the
 * Google button: its orange is Strava's, not T1's.
 */
export function StravaButton(): JSX.Element {
  const [isConnecting, setIsConnecting] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Link
        to="/runs/strava-connect"
        reloadDocument
        data-part="strava-button"
        onClick={() => {
          setIsConnecting(true);
        }}
        className="target inline-flex shrink-0"
      >
        <img
          src="/strava/btn_strava_connect_with_orange.svg"
          alt="Connect with Strava"
          width={237}
          height={48}
          className="block h-12 w-auto"
        />
      </Link>
      <Mono step="sm" className="text-label">
        <PendingLabel
          label=""
          pendingLabel="Connecting"
          pending={isConnecting}
        />
      </Mono>
    </div>
  );
}
