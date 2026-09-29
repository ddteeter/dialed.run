import type { JSX } from "react";

import { photoAcceptAttribute } from "../../../lib/photo-constraints";
import { Mono } from "../../../ui";

/**
 * What the band says when the garment saved and its photo did not — the
 * owner's words (task 122), kept by round 26 #4. Both halves are true at
 * once, so the sentence says both.
 */
export const PHOTO_NOT_SAVED = "Garment saved, photo didn't. Try again?";

/**
 * Why the photo did not go up, and whether the same file could.
 *
 * `canRetry` is round 26 #4's rule: **Try again only for a network
 * failure**, because it re-sends the same file, and a file refused for its
 * type or size would be refused again.
 */
export interface PhotoRefusal {
  reason: string;
  canRetry: boolean;
}

/**
 * Round 26 #4's band under F's well, once the garment is saved and its
 * photo was not: `PHOTO NOT ADDED`, the owner's sentence, the reason, and
 * the ways on — Try again (a network failure only) and Pick another.
 *
 * **Composed here rather than `ui`'s `FailureBand`**, which has one
 * button and no reason line; this band has two, and one of them is a file
 * picker. It keeps that band's grammar — ink rule, mono kicker, nothing
 * that moves — and its region name, so a harness finds either the same
 * way. Pick another is the file input inside its label, as the well's own
 * Replace is, so a new photo takes the same path as the first.
 */
export function PhotoRefused({
  refusal,
  onRetry,
  onFiles,
}: Readonly<{
  refusal: PhotoRefusal;
  onRetry: () => void;
  onFiles: (files: FileList | null) => void;
}>): JSX.Element {
  return (
    <div
      data-part="failure-band"
      data-state="failed"
      className="flex flex-col items-start gap-3 border border-ink p-4"
    >
      <Mono step="xs">Photo not added</Mono>
      <span className="text-body">{PHOTO_NOT_SAVED}</span>
      <span className="text-small text-label">{refusal.reason}</span>
      <div className="flex flex-wrap gap-2">
        {refusal.canRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="target cursor-pointer rounded-field border border-ink bg-ink px-4 py-3 text-body font-bold text-ground"
          >
            Try again
          </button>
        ) : undefined}
        <label className="target inline-flex cursor-pointer items-center rounded-field border border-hairline px-4 py-3 text-body font-semibold text-ink has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink">
          Pick another
          <input
            type="file"
            accept={photoAcceptAttribute}
            className="sr-only"
            onChange={(event) => {
              onFiles(event.target.files);
            }}
          />
        </label>
      </div>
    </div>
  );
}
