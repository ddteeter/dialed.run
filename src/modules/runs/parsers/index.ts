import type { RunSource } from "../../../lib/contracts";
import type { ImportExtension } from "../upload-limits";
import { importExtensionOf } from "../upload-limits";
import { fitSource } from "./fit";
import { gpxSource } from "./gpx";
import { tcxSource } from "./tcx";
import { RunParseError } from "./shared";

export { PARSE_FAILURE_MESSAGE, RunParseError } from "./shared";

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
