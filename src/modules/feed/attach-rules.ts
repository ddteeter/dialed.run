/**
 * A2's refusals, where both the screen and a test can reach them.
 *
 * A sibling that imports nothing server-side, for the reason
 * `route-decisions.ts` gives: the component that uses these ships to the
 * browser, and `entries.ts` and `photos.ts` reach `env`.
 */
import {
  isAllowedPhotoType,
  maxPhotoBytes,
  photoFormatWords,
} from "../../lib/photo-constraints";
import type { AttachContext } from "./attach-context";
import { attachKitInput } from "./inputs";
import { redirectTo } from "./redirect";

/**
 * The kit A2 sends: the server's own item-id list, plus round 20's rule
 * that there has to be one. *"A kit is required … tapping it with none
 * chosen marks the closet-picker group with the message band 'Pick at
 * least one piece.'"* Derived from `attachKitInput` rather than restating
 * its id shape and its cap, so the two cannot drift; the sentence lives
 * here, in the schema, because that is where error copy lives.
 */
export const kitChoice = attachKitInput.shape.itemIds.min(
  1,
  "Pick at least one piece.",
);

const MEGABYTE = 1024 * 1024;

/**
 * What is wrong with a picked photo, or nothing.
 *
 * A field failure — the fix is another file — so the well's field message
 * says it (round 22, "Well states": *"File type and size are field
 * failures"*). The type list and the cap are `lib/photo-constraints`', the
 * same two facts the upload route refuses by, so the screen cannot accept
 * a file the server would turn away.
 */
export function photoProblem(file: File): string | undefined {
  if (!isAllowedPhotoType(file.type)) {
    return `Photos must be ${photoFormatWords}.`;
  }
  if (file.size > maxPhotoBytes) {
    return `That photo is over ${String(maxPhotoBytes / MEGABYTE)} MB. Pick a smaller one.`;
  }
  return undefined;
}

/**
 * A2 for a run that already has a kit is A3 for its entry.
 *
 * The owner's backlog ruling keeps a kitted run with no verdict waiting,
 * so a runner can reach A2 for one — and `attachKit` never replaces a
 * kit, so whatever they picked would be dropped while the verdict was
 * saved against the kit already there. The route sends them on instead.
 */
export function orOnToVerdict(context: AttachContext): AttachContext {
  if (context.entryId !== undefined) {
    redirectTo({
      to: "/feed/verdict/$entryId",
      params: { entryId: context.entryId },
    });
  }
  return context;
}
