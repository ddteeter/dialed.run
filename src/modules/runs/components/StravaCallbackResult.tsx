import { Link } from "@tanstack/react-router";
import type { JSX } from "react";

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
 * **It wears `Page` because every screen must** (D-53): `Page` is what
 * stamps `html[data-hydrated="true"]`, which every e2e wait depends on —
 * one `Page` around every answer, so the screen has one heading.
 */
export function StravaCallbackResult({
  result,
  configured,
}: Readonly<{
  result: { ok: true } | { ok: false; reason: string; full: boolean };
  /**
   * Whether this deployment can talk to Strava at all. Not configured,
   * there is nothing to try again, so no Try again.
   */
  configured: boolean;
}>): JSX.Element {
  return (
    <Page width="panel" title="Strava">
      {result.ok ? (
        <Connected />
      ) : (
        <NotConnected result={result} configured={configured} />
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
  configured,
}: Readonly<{
  result: { full: boolean };
  configured: boolean;
}>): JSX.Element {
  // Try again is another trip to Strava's consent screen, through the
  // same server redirect the official button uses.
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
            to="/runs/strava-connect"
            reloadDocument
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
