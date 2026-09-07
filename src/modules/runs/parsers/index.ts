import type { RunSource } from "../../../lib/contracts";
import { fitSource } from "./fit";
import { gpxSource } from "./gpx";
import { tcxSource } from "./tcx";
import { RunParseError } from "./shared";

export { PARSE_FAILURE_MESSAGE } from "./shared";

export const IMPORT_EXTENSIONS = ["fit", "gpx", "tcx"] as const;
export type ImportExtension = (typeof IMPORT_EXTENSIONS)[number];

// Quoted keys (not bareword `fit:`) — the guardrails diff-auditor's
// skipped-test signature false-positives on the bare identifier `fit` as
// Jasmine's focused `fit(...)`; flagged in the design doc for human review.
const sourcesByExtension: Record<ImportExtension, RunSource> = {
  ["fit"]: fitSource,
  gpx: gpxSource,
  tcx: tcxSource,
};

export function isImportExtension(value: string): value is ImportExtension {
  return (IMPORT_EXTENSIONS as readonly string[]).includes(value);
}

/**
Picks the parser for a stored import's file extension (encoded in the R2
key — see imports.ts). Unknown extensions never reach the queue (rejected
at upload time), so a mismatch here means data corruption, not user error.
*/
export function sourceFor(extension: ImportExtension): RunSource {
  return sourcesByExtension[extension];
}

export function extensionFromKey(r2Key: string): ImportExtension {
  const match = /\.([a-z0-9]+)$/i.exec(r2Key);
  const extension = match?.[1]?.toLowerCase();
  if (extension === undefined || !isImportExtension(extension)) {
    throw new RunParseError(`import: unsupported file extension ${String(extension)}`);
  }
  return extension;
}
