import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { JSX } from "react";

import { writableAudienceOf } from "../../../lib/contracts";
import type { Audience, WritableAudience } from "../../../lib/contracts";
import { AUDIENCE_LABELS, Bracketed, PICKED_AUDIENCES } from "../../../ui";

/**
 * D's owner meta (round 41 #86a): who the runner's own kit is for, as the
 * bracketed state label — [PRIVATE], [SHARED] or [PUBLIC], MONO.xs ink —
 * and for a PUBLIC kit the line that says what that means, Copy link and
 * Change. Only the author sees it.
 *
 * - **Copy link** copies the kit's `/kit/<id>` page, absolute against the
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
/**
Said before the bracketed audience, to a reader only.
*/
export const AUDIENCE_PREFIX = "Seen by: ";
export const LINK_NOT_COPIED = "Link not copied.";

/**
The absolute address of a kit's public page, on the host the runner is on.
*/
export function publicKitUrl(entryId: string, origin: string): string {
  return new URL(`/kit/${entryId}`, origin).href;
}

/**
 * How long the pill holds its answer (AF1, "FOR [2000MS] AFTER"): a hold,
 * not an animation, so it is a time rather than a motion token.
 */
export const COPY_HOLD_MS = 2000;

/**
 * What the pill says: at rest, after a copy (AF1), and after a refused
 * copy. "Not copied" is the owner's call (2026-11-12), drawn by R55·171:
 * the rest look, only the word changed, and heard as "Link not copied."
 */
const PILL_WORD = {
  rest: "Copy link",
  copied: "Copied",
  refused: "Not copied",
} as const;
type PillState = keyof typeof PILL_WORD;

const PILL_STATES: readonly PillState[] = ["rest", "copied", "refused"];

// AF1: "Same button, same width, label swaps to the past tense and fills
// ink." The ink fill and edge are the copy's alone. At rest and refused the
// edge is a hairline with no fill, as R55·171 draws both.
const OUTLINE_PILL_CLASS =
  "target inline-grid cursor-pointer items-center rounded-pill border border-hairline bg-transparent px-5 text-body font-bold text-ink";
const FILLED_PILL_CLASS =
  "target inline-grid cursor-pointer items-center rounded-pill border border-ink bg-ink px-5 text-body font-bold text-ground";

const CHANGE_CLASS =
  "target inline-flex items-center text-body font-semibold text-ink underline underline-offset-4";

/**
 * D's owner meta, drawn as round 41 draws it: the audiences as tags with
 * the current one in ink, then for a PUBLIC kit the sentence in body ink,
 * an outlined Copy link pill and Change.
 *
 * **The three tags show in every state**, in MONO.xs, the current one in
 * ink and the other two muted (R55·172). The board's order is PUBLIC,
 * SHARED, PRIVATE, the picker's reversed. Only the current one is heard,
 * after its prefix; the other two are drawn and not read.
 */
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
    <div data-part="owner-meta" className="flex flex-col gap-3">
      <span className="flex flex-wrap gap-x-2">
        {TAG_ORDER.map((tag) =>
          tag === shown ? (
            <span key={tag} className="flex">
              <span className="sr-only">{AUDIENCE_PREFIX}</span>
              <Bracketed step="xs" className="text-ink">
                {AUDIENCE_LABELS[tag]}
              </Bracketed>
            </span>
          ) : (
            <span key={tag} aria-hidden="true" className="flex">
              <Bracketed step="xs" className="text-muted">
                {AUDIENCE_LABELS[tag]}
              </Bracketed>
            </span>
          ),
        )}
      </span>
      {shown === "world" ? (
        <>
          <p className="m-0 text-body text-ink">{PUBLIC_KIT_LINE}</p>
          <span className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <CopyLinkPill entryId={entryId} onStatus={onStatus} />
            <Link
              to="/feed/verdict/$entryId"
              params={{ entryId }}
              className={CHANGE_CLASS}
            >
              Change
            </Link>
          </span>
        </>
      ) : undefined}
    </div>
  );
}

/**
The board's order: the picker's, reversed.
*/
const TAG_ORDER: readonly WritableAudience[] = PICKED_AUDIENCES.toReversed();

/**
 * AF1's pill. Its words swap for `COPY_HOLD_MS` and then come back; its
 * name stays "Copy link" throughout, so it stays findable, and the status
 * region says what happened (AF1's screen-reader note). All three words
 * share one grid cell, so the pill is as wide as the longest and never
 * changes width.
 */
function CopyLinkPill({
  entryId,
  onStatus,
}: Readonly<{ entryId: string; onStatus: (sentence: string) => void }>) {
  const [state, setState] = useState<PillState>("rest");
  // No "already at rest" guard: at rest the timer sets "rest" again, which
  // React drops, so a guard would be a branch nothing can observe.
  useEffect(() => {
    const timer = globalThis.setTimeout(() => {
      setState("rest");
    }, COPY_HOLD_MS);
    return () => {
      globalThis.clearTimeout(timer);
    };
  }, [state]);
  return (
    <button
      type="button"
      data-state={state}
      aria-label={PILL_WORD.rest}
      className={state === "copied" ? FILLED_PILL_CLASS : OUTLINE_PILL_CLASS}
      onClick={() => {
        void didCopyLink(entryId, onStatus).then((isCopied) => {
          setState(isCopied ? "copied" : "refused");
        });
      }}
    >
      {PILL_STATES.map((word) => (
        <span
          key={word}
          aria-hidden="true"
          className={
            word === state
              ? "col-start-1 row-start-1 text-center"
              : "invisible col-start-1 row-start-1 text-center"
          }
        >
          {PILL_WORD[word]}
        </span>
      ))}
    </button>
  );
}

/**
 * Copies the kit's public address, and says whether it did: a clipboard
 * the browser refuses is a failure the runner should hear about, not a
 * press that did nothing.
 */
async function didCopyLink(
  entryId: string,
  onStatus: (sentence: string) => void,
): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(
      publicKitUrl(entryId, globalThis.location.origin),
    );
    onStatus(LINK_COPIED);
    return true;
  } catch {
    onStatus(LINK_NOT_COPIED);
    return false;
  }
}
