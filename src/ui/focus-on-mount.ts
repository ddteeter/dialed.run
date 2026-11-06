/**
 * A ref callback that focuses the element React has just attached: the
 * heading a screen lands on when it was arrived at to be read again (T1
 * and P3 after a refused Strava receipt's Try again, round 39 #66).
 * Pass it only when focus should move — `ref={should ? focusOnMount :
 * undefined}` — since it focuses on every attach.
 */
export function focusOnMount(node: HTMLElement | null): void {
  node?.focus();
}
