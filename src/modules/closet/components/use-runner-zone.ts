import { useSyncExternalStore } from "react";

/**
 * The zone the runner's device is in, once there is a device to ask.
 *
 * **Nothing stores a runner's zone** — the profile holds a city's lat/lng
 * and no zone name — so the device is the only honest answer to "whose
 * Sep 12 is this". Asked through `useSyncExternalStore` because that hook
 * is built for exactly this split: the server snapshot (`undefined`, read
 * as UTC) is what the server renders and what hydration compares against,
 * and the client snapshot takes over straight after — so a date near
 * midnight moves once after load rather than failing hydration, which is
 * the failure `lib/dates.ts` was written about.
 *
 * The zone never changes while a page is open, so there is nothing to
 * subscribe to.
 */
export function useRunnerZone(): string | undefined {
  return useSyncExternalStore(noChanges, deviceZone, serverZone);
}

function noChanges(): () => void {
  return unsubscribe;
}

function unsubscribe(): void {
  // Nothing was subscribed.
}

function deviceZone(): string {
  return new Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function serverZone(): undefined {
  return;
}
