import { Link } from "@tanstack/react-router";

import { Page } from "../../../ui";

/**
 * What the user sees after Strava sends them back.
 *
 * The exchange happens in the route's loader so the code is a one-shot —
 * no button, no client state to get out of sync (design doc 102 §6). This
 * renders the answer, and it is a component rather than markup in the
 * route because the answer has two shapes and a route cannot be tested.
 *
 * **It wears `Page` because every screen must**, which is the rule
 * `routes-stamp-hydration` now enforces (D-53). `Page` is what calls
 * `useHydrated`, so a screen without one stamps no
 * `html[data-hydrated="true"]` and every e2e wait on that attribute hangs
 * — with the failure landing a long way from the cause. Wearing it also
 * retired the hand-rolled `mx-auto flex w-full max-w-sm …` column that
 * `Page` exists to have exactly one of.
 */
export function StravaCallbackResult({
  result,
}: Readonly<{ result: { ok: true } | { ok: false; reason: string } }>) {
  return (
    <Page width="narrow" title={result.ok ? "Connected" : "Not connected"}>
      <p className="text-night/70">
        {result.ok
          ? "Strava is connected. We'll remind you to log your kit after a run."
          : result.reason}
      </p>
      <Link
        to="/runs/strava"
        className="self-start rounded-md bg-night px-4 py-2 font-semibold text-chalk"
      >
        Back to Strava settings
      </Link>
    </Page>
  );
}
