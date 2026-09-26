/**
 * What an upload is refused for, on both sides of the wire.
 *
 * **Split out of `./imports` because a route reaches this and must not
 * reach that** (D-50). `runs/inputs.ts` needs the cap and the error type to
 * validate a submission, routes import `inputs.ts`, and `imports.ts` pulls
 * `db/schema-core` and the FIT/GPX/TCX parsers with it — so one constant
 * and one three-word class were holding drizzle's column builders and the
 * Garmin SDK in the client bundle. Measured: ~7 kB of the entry chunk.
 *
 * This is the same shape `feed/route-decisions.ts` and `runs/not-found.ts`
 * already have, and the same rule CLAUDE.md states — a decision a route
 * needs goes in a sibling that imports nothing server-side.
 */

/**
 * 25 MB. A `.fit` from a watch is kilobytes; a multi-hour `.gpx` with
 * per-second track points is the case this is sized for.
 */
export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;

/**
 * Thrown for the things the upload step can reject outright — size, type,
 * an empty file. Never for a file that might still parse: those become an
 * `imports` row with a failure status, so the user can see what happened.
 */
export class ImportUploadError extends Error {}

/**
 * The file types an import reads. Here rather than beside the parsers so
 * A1's well can refuse a wrong file before sending it, by the same rule the
 * server refuses it by — without shipping the parsers to the browser.
 */
export const IMPORT_EXTENSIONS = ["fit", "gpx", "tcx"] as const;
export type ImportExtension = (typeof IMPORT_EXTENSIONS)[number];

/**
 * The extension of a path, if it is one we can import — the last one, in
 * any case, so `RUN.GPX` reads and `run.gpx.zip` does not.
 *
 * The *rule* for what counts lives here, once. Callers decide what a miss
 * means: an upload refuses with copy the runner reads, while an unreadable
 * R2 key is an internal parse failure.
 */
export function importExtensionOf(path: string): ImportExtension | undefined {
  const lower = path.toLowerCase();
  return IMPORT_EXTENSIONS.find((extension) => lower.endsWith(`.${extension}`));
}

/**
 * A1's sentences for a file refused before it is read (round 22, "A1 Parse
 * failed": *"wrong type → 'That's not a GPX, TCX or FIT file.'"*). The other
 * two are the ones the upload step always refused with.
 */
export const UPLOAD_REFUSALS = {
  wrongType: "That's not a GPX, TCX or FIT file.",
  empty: "That file is empty.",
  tooLarge: "That file is larger than 25 MB.",
} as const;

/**
 * Whether a file can be sent, judged before a byte of it is read: the
 * extension it will be parsed as, or the sentence refusing it.
 *
 * Asked by the well, which marks the field and sends nothing, and by
 * `startImport`, which refuses the same file for the same reason if one
 * arrives anyway — one rule, run twice, as the Form Contract asks. The
 * extension rides along in the answer so the server never asks twice.
 */
export type UploadCheck =
  | Readonly<{ ok: true; extension: ImportExtension }>
  | Readonly<{ ok: false; problem: string }>;

export function checkUpload(file: { name: string; size: number }): UploadCheck {
  const extension = importExtensionOf(file.name);
  if (extension === undefined) {
    return { ok: false, problem: UPLOAD_REFUSALS.wrongType };
  }
  if (file.size === 0) return { ok: false, problem: UPLOAD_REFUSALS.empty };
  if (file.size > MAX_IMPORT_BYTES) {
    return { ok: false, problem: UPLOAD_REFUSALS.tooLarge };
  }
  return { ok: true, extension };
}

/**
 * A file that arrived and would not parse — round 22's third sentence,
 * *"unreadable → 'We couldn't read this file. Export it again.'"*.
 */
export const PARSE_FAILURE_MESSAGE =
  "We couldn't read this file. Export it again.";

/**
 * A file that parsed and held no run: no track points, no lap, no session.
 * Stored without the file's name, because the import row does not keep
 * one; the screen that has the name puts it back (`parseFailureSentence`).
 */
export const NO_TRACK_MESSAGE =
  "This file has no track in it. Export the run again.";

/**
 * The sentence A1 shows for a failed parse. Round 22 names the file —
 * *"MORNING_RUN.GPX has no track in it. Export the run again."* — and only
 * the screen knows it, so the stored "This file" becomes its name here.
 * An import that failed with no reason recorded reads as unreadable.
 */
export function parseFailureSentence(
  reason: string | null,
  filename: string,
): string {
  if (reason === NO_TRACK_MESSAGE) {
    return `${filename} has no track in it. Export the run again.`;
  }
  return reason ?? PARSE_FAILURE_MESSAGE;
}
