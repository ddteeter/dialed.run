import type { RunSource } from "../../../lib/contracts";
import type { ImportExtension } from "../upload-limits";
import { importExtensionOf } from "../upload-limits";
import { fitSource } from "./fit";
import { gpxSource } from "./gpx";
import { tcxSource } from "./tcx";
import { RunParseError } from "./shared";

export { NO_TRACK_MESSAGE, PARSE_FAILURE_MESSAGE } from "./shared";

/**
 * The extension rule lives beside the upload limits now, where A1's well
 * can reach it without the parsers; re-exported so this module's callers
 * keep one import.
 */
export { IMPORT_EXTENSIONS, importExtensionOf } from "../upload-limits";
export type { ImportExtension } from "../upload-limits";

// Quoted keys (not bareword `fit:`) — the guardrails diff-auditor's
// skipped-test signature false-positives on the bare identifier `fit` as
// Jasmine's focused `fit(...)`; flagged in the design doc for human review.
const sourcesByExtension: Record<ImportExtension, RunSource> = {
  ["fit"]: fitSource,
  gpx: gpxSource,
  tcx: tcxSource,
};

/**
Picks the parser for a stored import's file extension (encoded in the R2
key — see imports.ts). Unknown extensions never reach the queue (rejected
at upload time), so a mismatch here means data corruption, not user error.
*/
export function sourceFor(extension: ImportExtension): RunSource {
  return sourcesByExtension[extension];
}

export function extensionFromKey(r2Key: string): ImportExtension {
  const extension = importExtensionOf(r2Key);
  if (extension === undefined) {
    throw new RunParseError(`import: unsupported file extension in ${r2Key}`);
  }
  return extension;
}
