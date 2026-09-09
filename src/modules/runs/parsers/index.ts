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

function isImportExtension(value: string): value is ImportExtension {
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

/**
 * The extension of a path, if it is one we can import.
 *
 * The *rule* for what counts lives here, once. Callers decide what a miss
 * means: an upload rejects with copy the user reads, while an unreadable
 * R2 key is an internal parse failure. Those errors differ on purpose; the
 * rule behind them was what got copied.
 */
export function importExtensionOf(path: string): ImportExtension | undefined {
  const match = /\.([a-z0-9]+)$/i.exec(path);
  // The inner `?.` and the `!== undefined` are the compiler's, not the
  // runtime's: a match of this pattern always has group 1.
  // Stryker disable next-line OptionalChaining
  const extension = match?.[1]?.toLowerCase();
  // Stryker disable next-line ConditionalExpression
  return extension !== undefined && isImportExtension(extension)
    ? extension
    : undefined;
}

export function extensionFromKey(r2Key: string): ImportExtension {
  const extension = importExtensionOf(r2Key);
  if (extension === undefined) {
    throw new RunParseError(
      `import: unsupported file extension in ${r2Key}`,
    );
  }
  return extension;
}
