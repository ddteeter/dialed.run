import { Link } from "@tanstack/react-router";
import type { JSX } from "react";

import { writableAudienceOf } from "../../../lib/contracts";
import type { Audience } from "../../../lib/contracts";
import { AUDIENCE_LABELS, Bracketed } from "../../../ui";

/**
 * D's owner meta (round 41 #86a): who the runner's own kit is for, as the
 * bracketed state label — [PRIVATE], [SHARED] or [PUBLIC], MONO.xs ink —
 * and for a PUBLIC kit the line that says what that means, Copy link and
 * Change. Only the author sees it.
 *
 * - **Copy link** copies the kit's `/k/<id>` page, absolute against the
 *   host the runner is on, so it is the app's host wherever the app runs
 *   and nothing here names one. What happened is said in the screen's
 *   status region (`onStatus`), as Useful's count is.
 * - **Change** opens A3, which holds the same picker, rather than a sheet
 *   over D: A3 saves the audience with the verdict, and D has no write of
 *   the audience alone.
 *
 * A stored `groups`, which nothing can write yet, reads as PRIVATE, as
 * every writer stores it again.
 */
export const PUBLIC_KIT_LINE = "Public: anyone with the link can see it.";
export const LINK_COPIED = "Link copied.";
export const LINK_NOT_COPIED = "Link not copied.";

/**
The absolute address of a kit's public page, on the host the runner is on.
*/
export function publicKitUrl(entryId: string, origin: string): string {
  return new URL(`/k/${entryId}`, origin).href;
}

const IN_LINE_BUTTON =
  "target cursor-pointer border-none bg-transparent p-0 text-small font-semibold text-ink underline underline-offset-4";

export function OwnerAudience({
  entryId,
  audience,
  onStatus,
}: Readonly<{
  entryId: string;
  audience: Audience;
  onStatus: (sentence: string) => void;
}>): JSX.Element {
  const shown = writableAudienceOf(audience);
  return (
    <div data-part="owner-meta" className="flex flex-col gap-2">
      <Bracketed step="xs" className="text-ink">
        {AUDIENCE_LABELS[shown]}
      </Bracketed>
      {shown === "world" ? (
        <p className="m-0 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-small text-muted">
          {PUBLIC_KIT_LINE}
          <button
            type="button"
            className={IN_LINE_BUTTON}
            onClick={() => {
              void copyLink(entryId, onStatus);
            }}
          >
            Copy link
          </button>
          <Link
            to="/feed/verdict/$entryId"
            params={{ entryId }}
            className={IN_LINE_BUTTON}
          >
            Change
          </Link>
        </p>
      ) : undefined}
    </div>
  );
}

/**
 * Copies the kit's public address, and says whether it did: a clipboard
 * the browser refuses is a failure the runner should hear about, not a
 * press that did nothing.
 */
async function copyLink(
  entryId: string,
  onStatus: (sentence: string) => void,
): Promise<void> {
  try {
    await navigator.clipboard.writeText(
      publicKitUrl(entryId, globalThis.location.origin),
    );
    onStatus(LINK_COPIED);
  } catch {
    onStatus(LINK_NOT_COPIED);
  }
}
