import { Link } from "@tanstack/react-router";

/**
 * What the user sees after Strava sends them back.
 *
 * The exchange happens in the route's loader so the code is a one-shot —
 * no button, no client state to get out of sync (design doc 102 §6). This
 * renders the answer, and it is a component rather than markup in the
 * route because the answer has two shapes and a route cannot be tested.
 */
export function StravaCallbackResult({
  result,
}: Readonly<{ result: { ok: true } | { ok: false; reason: string } }>) {
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-4 px-6 py-16 text-center">
      <h1 className="m-0 font-display text-2xl uppercase leading-none">
        {result.ok ? "Connected" : "Not connected"}
      </h1>
      <p className="text-night/70">
        {result.ok
          ? "Strava is connected. We'll remind you to log your kit after a run."
          : result.reason}
      </p>
      <Link
        to="/runs/strava"
        className="rounded-md bg-night px-4 py-2 font-semibold text-chalk"
      >
        Back to Strava settings
      </Link>
    </div>
  );
}
