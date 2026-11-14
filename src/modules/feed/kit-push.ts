import { useSyncExternalStore } from "react";
import { z } from "zod";

import { uiGroups } from "./groups";

/**
 * A2b at the desk is a push, not a sheet (Round 54 · 164.3): *"the URL
 * changes, so Back works. A list that can grow pushes."* The category it
 * pushed to rides in A2's own URL, `?pick=tops`, so A2 stays the page and
 * keeps everything the runner has done on it — the picks, and a held
 * photo no URL could carry. Parsed, because it came from the address bar:
 * anything that is not a group reads as no push, and A2 is drawn.
 */
export const attachSearch = z.object({
  pick: z.enum(uiGroups).optional().catch(undefined),
});

/**
 * A3b at the desk is the same push (Round 54 · 164.3): `?specifics=true`
 * on A3's own URL, so A3 stays the page and its answer — the verdict,
 * chips, flags and effort, none of them saved yet — is still there when
 * the runner comes back. Anything but `true` reads as no push.
 */
export const verdictSearch = z.object({
  specifics: z.boolean().optional().catch(undefined),
});

/**
 * The desk breakpoint (`--breakpoint-desk` in `styles.css`'s `@theme`
 * block), as a media query: the width from which a category pushes rather
 * than opening a sheet. Below it the sheet stays as it is.
 */
export const DESK_MEDIA_QUERY = "(min-width: 1040px)";

/**
Whether the window is at the desk now — read when the runner presses.
*/
export function isAtDesk(): boolean {
  return matchMedia(DESK_MEDIA_QUERY).matches;
}

function subscribeToDesk(onChange: () => void): () => void {
  const query = matchMedia(DESK_MEDIA_QUERY);
  query.addEventListener("change", onChange);
  return () => {
    query.removeEventListener("change", onChange);
  };
}

/**
 * Below the desk, as far as the server can tell: it has no window, and
 * the sheet is the press's answer at every width but one.
 */
function isAtDeskOnTheServer(): boolean {
  return false;
}

/**
 * Whether the window is at the desk, kept current as it is resized — for
 * what a trigger *says* it does (`aria-haspopup`), where `isAtDesk` is for
 * what the press does. The server draws below the desk, and the first
 * render after hydration corrects it.
 */
export function useIsAtDesk(): boolean {
  return useSyncExternalStore(subscribeToDesk, isAtDesk, isAtDeskOnTheServer);
}
