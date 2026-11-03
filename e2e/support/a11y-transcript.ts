import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import type { Virtual } from "@guidepup/virtual-screen-reader";
import type { Page } from "@playwright/test";

/**
 * Plan 161, step 4: what a screen reader would say on a test's final
 * state, read by Guidepup's virtual screen reader in the page
 * (`docs/designs/161-a11y-coverage.md` §4). The fixture snapshots it, so
 * a change in what is announced is a diff someone reviews.
 */

/**
 * Guidepup's browser build is one ES module with one `export {…}`. The
 * app's CSP admits no blob or inline module, so it is rewritten into a
 * script that sets a global, and evaluated through the debugger protocol,
 * which the CSP does not govern. Its last line is a source-map comment,
 * hence the closer on a line of its own.
 */
export function classicScript(module: string): string {
  const exported = /export\{(?<names>[^}]*)\};?/u.exec(module);
  const names = exported?.groups?.names;
  if (exported === null || names === undefined) {
    throw new Error("Guidepup's browser build has no export statement");
  }
  const fields = names.split(",").map((pair) => {
    const [local = "", as = local] = pair.trim().split(" as ", 2);
    return `${as}: ${local}`;
  });
  const end = exported.index + exported[0].length;
  const assign = `globalThis.__guidepup = { ${fields.join(", ")} };`;
  const body = `${module.slice(0, exported.index)}${assign}${module.slice(end)}`;
  return `(() => {\n${body}\n})();`;
}

const GUIDEPUP = classicScript(
  readFileSync(
    createRequire(import.meta.url).resolve(
      "@guidepup/virtual-screen-reader/browser.js",
    ),
    "utf8",
  ),
);

/**
 * How far a transcript may run before it is cut: a long feed is a few
 * hundred phrases, and a page that never ends must still end.
 */
export const MAX_PHRASES = 1500;

/**
 * The phrases it says last, which mark the end of the walk: Guidepup
 * moves past it back to the start.
 */
const END = "end of document";

/**
 * What differs between two runs of the same test, and between the dev
 * server and the build: ids, seeded handles and every number (counts,
 * times, dates, temperatures). A transcript is about what is said and
 * in what order; the values are other tests' business. Heading levels
 * and list positions stay.
 */
export function normalize(phrase: string): string {
  return (
    phrase
      .replaceAll(/[0-9A-HJKMNP-TV-Z]{26}/gu, ":id")
      .replaceAll(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\b/giu, ":day")
      .replaceAll(
        /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b/giu,
        ":month",
      )
      // A heading's level and a list item's place are structure, not data.
      .replaceAll(/(?<!level |position |set size |\d)\d+/gu, "#")
      .replaceAll(/#:# ?[AP]M/gu, "#:#")
  );
}

/**
 * Guidepup's reader, as `globalThis.__guidepup.virtual`.
 */
export async function loadReader(page: Page): Promise<void> {
  await page.evaluate(GUIDEPUP);
}

/**
 * The page's transcript, from the top to the end of the document.
 */
export async function transcriptOf(page: Page): Promise<string[]> {
  await loadReader(page);
  const phrases = await page.evaluate(
    async ({ end, max }) => {
      const reader = globalThis.__guidepup?.virtual;
      if (reader === undefined) return [];
      await reader.start({
        container: globalThis.document.body,
        displayCursor: false,
      });
      try {
        for (let step = 0; step < max; step += 1) {
          await reader.next();
          if ((await reader.lastSpokenPhrase()) === end) break;
        }
        return await reader.spokenPhraseLog();
      } finally {
        await reader.stop();
      }
    },
    { end: END, max: MAX_PHRASES },
  );
  return phrases.map((phrase) => normalize(phrase));
}

/**
 * The reader's methods `transcriptOf` calls, typed by Guidepup's own
 * class rather than restated. The spec checks the installed build has
 * each.
 */
export const READER_METHODS = [
  "start",
  "next",
  "lastSpokenPhrase",
  "spokenPhraseLog",
  "stop",
] as const satisfies readonly (keyof Virtual)[];

declare global {
  var __guidepup:
    { virtual: Pick<Virtual, (typeof READER_METHODS)[number]> } | undefined;
}
