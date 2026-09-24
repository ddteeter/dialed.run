import { useEffect, useState } from "react";

/**
 * The zone the runner's device is in, once there is a device to ask.
 *
 * **Nothing stores a runner's zone** — the profile holds a city's lat/lng
 * and no zone name — so the device is the only honest answer to "whose
 * Sep 12 is this".
 *
 * `undefined` (read as UTC) on the first render, which is also what the
 * server renders, so hydration compares like with like; the device's zone
 * after mount. A date near midnight therefore moves once after load rather
 * than failing hydration, which is the failure `lib/dates.ts` was written
 * about.
 *
 * The effect has no dependency list on purpose: it runs after every render
 * and sets the same string, which React ignores — and there is then no
 * array for a mutant to replace with another constant one.
 */
export function useRunnerZone(): string | undefined {
  const [zone, setZone] = useState<string | undefined>();
  useEffect(() => {
    setZone(new Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
  return zone;
}
