import { Link } from "@tanstack/react-router";
import type { JSX } from "react";

/**
 * "STRAVA REMINDERS · ON ›", on a line under the runs list's title (Round
 * 55 · 235c), where it was a muted link alone under the list that read
 * as the empty state's second action. Not configured, there is nothing to
 * turn on, so no line — never a dead control.
 */
export function StravaRemindersLine({
  configured,
  connected,
}: Readonly<{ configured: boolean; connected: boolean }>):
  JSX.Element | undefined {
  if (!configured) return undefined;
  return (
    <Link
      to="/runs/strava"
      className="target inline-flex items-center self-start font-mono text-mono-xs text-ink uppercase underline underline-offset-4"
    >
      Strava reminders · {connected ? "On" : "Off"}
      {/* The › is drawn, not said. */}
      <span aria-hidden="true">&nbsp;&rsaquo;</span>
    </Link>
  );
}
