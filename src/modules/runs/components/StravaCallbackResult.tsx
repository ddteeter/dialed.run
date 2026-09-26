import { Link } from "@tanstack/react-router";
import type { JSX } from "react";

import {
  ControlFailureBand,
  FormStatus,
  inFlight,
  Mono,
  Page,
  PendingLabel,
  useControlAction,
} from "../../../ui";
import { leaveForStrava } from "./StravaConnect";

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
 * The exchange happens in the route's loader so the code is a one-shot —
 * no button, no client state to get out of sync (design doc 102 §6). This
 * renders the answer, and it is a component rather than markup in the
 * route because the answer has three shapes and a route cannot be tested.
 *
 * **It wears `Page` because every screen must** (D-53): `Page` is what
 * stamps `html[data-hydrated="true"]`, which every e2e wait depends on —
 * one `Page` around both answers, so the screen has one heading.
 */
export function StravaCallbackResult({
  result,
  configured,
  getAuthorizeUrl,
}: Readonly<{
  result: { ok: true } | { ok: false; reason: string };
  /**
   * Whether this deployment can talk to Strava at all. Not configured,
   * there is nothing to try again, so no Try again.
   */
  configured: boolean;
  getAuthorizeUrl: () => Promise<string | undefined>;
}>): JSX.Element {
  const again = useControlAction({
    kicker: "Not connected",
    action: async () => leaveForStrava(getAuthorizeUrl),
  });

  return (
    <Page width="panel" title="Strava">
      {result.ok ? (
        <>
          <div data-slot="receipt" className="flex flex-col gap-2">
            <Mono step="xs" className="text-dialed-text">
              Connected
            </Mono>
            <h2 className="m-0 text-lead font-bold">Strava connected.</h2>
            <p className="m-0 text-body">
              After each run, we&rsquo;ll remind you to add it here. You upload
              the file (GPX, TCX or FIT) from your watch or a Strava export,
              then add what you wore.
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
      ) : (
        <>
          <FormStatus>{again.status}</FormStatus>
          <p data-slot="receipt" className="m-0 text-body">
            Strava isn&rsquo;t connected. Nothing changed.
          </p>
          <div className="flex flex-wrap gap-2">
            {configured ? (
              <button
                type="button"
                {...inFlight(again.pending)}
                onClick={() => {
                  void again.run();
                }}
                className="target rounded-field border-none bg-ink px-4 font-bold text-ground"
              >
                <PendingLabel
                  label="Try again"
                  pendingLabel="Connecting"
                  pending={again.pending}
                />
              </button>
            ) : undefined}
            <Link
              to="/runs"
              className="target inline-flex items-center justify-center rounded-field border border-ink px-4 font-semibold text-ink no-underline"
            >
              Not now
            </Link>
          </div>
          <ControlFailureBand
            failure={again.failure}
            onRetry={again.retry}
            retryRef={again.retryRef}
          />
        </>
      )}
    </Page>
  );
}
