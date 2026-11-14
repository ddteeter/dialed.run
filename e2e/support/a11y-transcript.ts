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
 * server and the build: ids (whole or short), seeded handles and every number (counts,
 * times, dates, temperatures), and a post's "2h ago" or "Yesterday",
 * which depends on the hour the test runs. A transcript is about what is said and
 * in what order; the values are other tests' business. Heading levels
 * and list positions stay.
 */
export function normalize(phrase: string): string {
  return (
    phrase
      .replaceAll(/[0-9A-HJKMNP-TV-Z]{26}/gu, ":id")
      // The Desk's short id (`safety/components/short-id.ts`): an id's
      // first and last four, whose tail is the id's random part.
      .replaceAll(/[0-9A-HJKMNP-TV-Z]{4}…[0-9A-HJKMNP-TV-Z]{4}/gu, ":id")
      .replaceAll(DAY_NAME, ":day")
      .replaceAll(MONTH_NAME, ":month")
      // A heading's level and a list item's place are structure, not data.
      .replaceAll(/(?<!level |position |set size |\d)\d+/gu, "#")
      .replaceAll(/#:# ?[AP]M/gu, "#:#")
      // When a post's run was, against the clock (`feed/posted.ts`).
      .replaceAll(/# ?[mhd] ago\b|\b(?:Yesterday|Today)\b/gu, ":when")
  );
}

/**
 * Whole names only, as the app writes them or shouts them: "Sat" and
 * "SATURDAY" are days, "Mono" and "satisfy" are not, and "may" in a
 * sentence is not a month.
 */
function namesOf(names: readonly string[]): RegExp {
  const all = names.flatMap((name) => [name, name.toUpperCase()]);
  return new RegExp(String.raw`\b(?:${all.join("|")})\b`, "gu");
}

const DAY_NAME = namesOf([
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
]);

const MONTH_NAME = namesOf([
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Sept",
  "Oct",
  "Nov",
  "Dec",
]);

/**
The native controls whose checked state lives in a property.
*/
const NATIVE_BOXES = 'input[type="checkbox"], input[type="radio"]';

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
    async ({ end, max, boxes }) => {
      const reader = globalThis.__guidepup?.virtual;
      if (reader === undefined) return [];
      // Guidepup reads a native checkbox or radio's state from its
      // `checked` attribute, which is only its state as first rendered:
      // one ticked since then reads "not checked". So the attribute
      // follows the property while the reader is on the page, and is put
      // back after. Changing it does not move the property: where the two
      // differ the control has been set since render, and the attribute
      // no longer drives it.
      const stale = [
        ...globalThis.document.querySelectorAll<HTMLInputElement>(boxes),
      ].filter((input) => input.checked !== input.hasAttribute("checked"));
      for (const input of stale) input.toggleAttribute("checked");
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
        for (const input of stale) input.toggleAttribute("checked");
      }
    },
    { end: END, max: MAX_PHRASES, boxes: NATIVE_BOXES },
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
