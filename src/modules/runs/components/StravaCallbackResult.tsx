import { Link } from "@tanstack/react-router";
import type { JSX } from "react";

import type { StravaOrigin } from "../../../lib/strava-origin";
import { Mono, Page } from "../../../ui";

/**
 * What the runner sees after Strava sends them back — a receipt in the
 * panel (round 22, item 23): *"Connected: '…' + Continue. Not connected
 * (cancel or denied):
 * 'Strava isn't connected. Nothing changed.' + Try again / Not now. Not
 * configured: the row and button are absent — never a dead control."*
 *
 * **The connected receipt is round 25's** ("Strava reminds. You upload."):
 * round 22 drew "New runs arrive on their own", which promised an import
 * the app does not do — Strava's webhook only makes a reminder, and no
 * activity data is ever stored. Every line says the same three things: a
 * run happened, we remind you, you add the file.
 *
 * **Full is its own receipt** (task 127, STR-6). Strava caps how many
 * runners a new app may connect, and the friends stage runs at that cap:
 * the eleventh friend's exchange is refused, and "try again" would only be
 * refused again. So it says what happened and offers no Try again.
 * Undesigned; the copy is a placeholder.
 *
 * The exchange happens in the route's loader so the code is a one-shot —
 * no button, no client state to get out of sync (design doc 102 §6). This
 * renders the answer, and it is a component rather than markup in the
 * route because the answer has several shapes and a route cannot be
 * tested.
 *
 * **It wears `Page` because every screen must** (R-53): `Page` is what
 * stamps `html[data-hydrated="true"]`, which every e2e wait depends on —
 * one `Page` around every answer, so the screen has one heading.
 */
export function StravaCallbackResult({
  result,
  from,
  configured,
}: Readonly<{
  result: { ok: true } | { ok: false; reason: string; full: boolean };
  /**
  Where the trip started when it was not T1 — P3 — for Try again.
  */
  from: StravaOrigin | undefined;
  /**
   * Whether this deployment can talk to Strava at all. Not configured,
   * there is nothing to try again, so no Try again.
   */
  configured: boolean;
}>): JSX.Element {
  return (
    <Page title="Strava">
      {result.ok ? (
        <Connected />
      ) : (
        <NotConnected result={result} from={from} configured={configured} />
      )}
    </Page>
  );
}

function Connected(): JSX.Element {
  return (
    <>
      <div data-slot="receipt" className="flex flex-col gap-2">
        <Mono step="xs" className="text-dialed-text">
          Connected
        </Mono>
        <h2 className="m-0 text-lead font-bold">Strava connected.</h2>
        <p className="m-0 text-body">
          After each run, we&rsquo;ll remind you to add it here. You upload the
          file (GPX, TCX or FIT) from your watch or a Strava export, then add
          what you wore.
        </p>
        <p className="m-0 text-small text-muted">
          We don&rsquo;t copy runs from Strava.
        </p>
      </div>
      <Link
        to="/runs/strava"
        className="target inline-flex items-center justify-center self-start rounded-field bg-ink px-4 font-bold text-ground no-underline"
      >
        Continue
      </Link>
    </>
  );
}

function NotConnected({
  result,
  from,
  configured,
}: Readonly<{
  result: { full: boolean };
  from: StravaOrigin | undefined;
  configured: boolean;
}>): JSX.Element {
  // Try again goes back to the consent rather than straight to the
  // redirect: what Strava's API Policy §2.1 asks for is read before every
  // trip to Strava's authorize screen (owner, 2026-10-18). Round 39 #66:
  // to T1, or to P3's offer when the trip started there, with focus on
  // the heading (`again`), so the consent is the next thing read.
  const canTryAgain = configured && !result.full;
  return (
    <>
      {result.full ? (
        <div
          data-slot="receipt"
          data-state="full"
          className="flex flex-col gap-2"
        >
          <Mono step="xs" className="text-muted">
            Strava is full
          </Mono>
          <p className="m-0 text-body">
            Strava lets a new app connect only a few runners while it is
            reviewed, and dialed.run is at that limit. Nothing changed.
          </p>
          <p className="m-0 text-small text-muted">
            You can still add every run by uploading its file.
          </p>
        </div>
      ) : (
        <p data-slot="receipt" className="m-0 text-body">
          Strava isn&rsquo;t connected. Nothing changed.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {canTryAgain ? (
          <Link
            to={from === "onboarding" ? "/onboarding/done" : "/runs/strava"}
            search={{ again: true }}
            className="target inline-flex items-center justify-center rounded-field bg-ink px-4 font-bold text-ground no-underline"
          >
            Try again
          </Link>
        ) : undefined}
        <Link
          to="/runs"
          className="target inline-flex items-center justify-center rounded-field border border-ink px-4 font-semibold text-ink no-underline"
        >
          Not now
        </Link>
      </div>
    </>
  );
}
