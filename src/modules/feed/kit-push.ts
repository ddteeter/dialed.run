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
