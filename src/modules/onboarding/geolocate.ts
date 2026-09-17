/**
 * Ask the browser where the runner is, and treat a refusal as an answer.
 *
 * **It never rejects.** Requirement 1 is that a denied permission must not
 * block onboarding, and the shape is what enforces it: a caller cannot
 * forget a `catch` on a function that has no failure mode. Denied,
 * unavailable, timed out and "this browser has no geolocation" all come
 * back the same way — `undefined`, meaning *no coordinates*, which is
 * exactly what O1 does with them.
 *
 * Lives here rather than inside `CalibrateForm` so the form takes it as a
 * prop: a component that called `navigator.geolocation` directly would be
 * untestable in the one case that matters, which is refusal.
 *
 * The timeout is the browser's own rather than an `AbortSignal` — this is
 * not an outbound fetch (law 4), it is a permission prompt, and a person
 * reading a dialog is not a slow upstream. Ten seconds matches the app's
 * fetch default so the two are not gratuitously different.
 */
const PROMPT_TIMEOUT_MS = 10_000;

export function geolocate(): Promise<{ lat: number; lng: number } | undefined> {
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      () => {
        resolve(undefined);
      },
      { timeout: PROMPT_TIMEOUT_MS },
    );
  });
}
