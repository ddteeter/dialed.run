import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Writes an eval's `results.md` beside the script that produced it, and
 * says what it covered.
 *
 * Both evals ended with the same four lines — resolve my own directory,
 * join `results.md`, write, log "N of M". That is a small thing to share,
 * but it is the shape a clone detector sees, and the alternative to sharing
 * it is a suppression explaining why two identical tails are different
 * ideas. They are not; they are the same idea written twice.
 *
 * `scriptUrl` is the caller's `import.meta.url`, because the file belongs
 * next to the script rather than next to this helper.
 */
export function writeReport(params: {
  scriptUrl: string;
  markdown: string;
  covered: number;
  total: number;
  /**
  Plural noun for the log line — "pages", "photos".
  */
  noun: string;
}): void {
  const here = path.dirname(fileURLToPath(params.scriptUrl));
  const out = path.join(here, "results.md");
  writeFileSync(out, params.markdown, "utf8");
  console.log(
    `\n${String(params.covered)} of ${String(params.total)} ${params.noun} -> ${out}`,
  );
}
