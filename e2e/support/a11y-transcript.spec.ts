import type { Virtual } from "@guidepup/virtual-screen-reader";
import { expect, test } from "@playwright/test";

import {
  classicScript,
  loadReader,
  normalize,
  READER_METHODS,
  transcriptOf,
} from "./a11y-transcript";

/**
 * Plan 161, step 4: the transcript a test's final state is snapshotted
 * as (`a11y-transcript.ts`).
 */

test("a probe page is read top to bottom, once", async ({ page }) => {
  await page.setContent(`
    <header><a href="/">dialed.run</a></header>
    <main>
      <h1>Closet</h1>
      <h2>Tops</h2>
      <ul><li>Half-zip</li><li>Tee</li></ul>
      <label>Name <input value="Rover"></label>
      <p>Worn on 14 runs since Sat Aug 29</p>
    </main>`);
  expect(await transcriptOf(page)).toEqual([
    "document",
    "banner",
    "link, dialed.run",
    "end of banner",
    "main",
    "heading, Closet, level 1",
    "heading, Tops, level 2",
    "list",
    "listitem, level 1, position 1, set size 2",
    "Half-zip",
    "end of listitem, level 1, position 1, set size 2",
    "listitem, level 1, position 2, set size 2",
    "Tee",
    "end of listitem, level 1, position 2, set size 2",
    "end of list",
    "Name",
    "textbox, Name, Rover",
    "paragraph",
    "Worn on # runs since :day :month #",
    "end of paragraph",
    "end of main",
    "end of document",
  ]);
});

test("what differs between runs is normalized, and structure is not", () => {
  expect(normalize("Kit 01M6H3VMJB8Y4HRSP8T7FPRGG8, closet_17")).toBe(
    "Kit :id, closet_#",
  );
  expect(normalize("Ran at 6:42 AM on Monday, November 3")).toBe(
    "Ran at #:# on :day, :month #",
  );
  expect(normalize("heading, 7 waiting, level 2")).toBe(
    "heading, # waiting, level 2",
  );
  expect(normalize("listitem, level 1, position 3, set size 12")).toBe(
    "listitem, level 1, position 3, set size 12",
  );
  expect(normalize("@trail_7 2h ago · 6:04 AM, SAT AUG 29")).toBe(
    "@trail_# :when · #:#, :day :month #",
  );
  expect(normalize("Yesterday · 6:04 AM; 15m ago")).toBe(":when · #:#; :when");
  // Whole names only: a word that starts like one is a word.
  expect(normalize("IBM Plex Mono; Garmin may satisfy a marked notice")).toBe(
    "IBM Plex Mono; Garmin may satisfy a marked notice",
  );
});

test("the module build becomes a script that sets a global", async ({
  page,
}) => {
  const script = classicScript(
    "var a=1,b=2;export{a as virtual,b as Virtual};\n//# sourceMappingURL=x.js.map",
  );
  await page.evaluate(script);
  expect(await page.evaluate(() => globalThis.__guidepup)).toEqual({
    virtual: 1,
    Virtual: 2,
  });
  expect(await page.evaluate(() => "a" in globalThis)).toBe(false);
  expect(() => classicScript("var a=1;")).toThrow(/no export statement/u);
});

test("the installed build has every method the transcript calls", async ({
  page,
}) => {
  await loadReader(page);
  const methods: readonly (keyof Virtual)[] = READER_METHODS;
  const kinds = await page.evaluate(
    (names) =>
      names.map(
        (name) =>
          typeof Reflect.get(globalThis.__guidepup?.virtual ?? {}, name),
      ),
    [...methods],
  );
  expect(kinds).toEqual(methods.map(() => "function"));
});
