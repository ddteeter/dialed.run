import { readFileSync } from "node:fs";

import type { Page } from "@playwright/test";

/**
 * Composition conformance: does the built screen match the board?
 *
 * **The boards are HTML, which is the whole opportunity.** A design spec
 * that is a picture can only be compared by eye; one that is a document
 * can be rendered, measured, and diffed. So this loads the artboard in the
 * same browser as the app, extracts the same signature from both, and
 * compares them.
 *
 * **It compares relations, not pixels.** What comes out is "which strings
 * sit on which row, in what order, in which colour role" — never a
 * screenshot. That matters for three reasons, each learned the expensive
 * way:
 *
 * - A pixel diff would be defeated by the board's fake data ("SAT AUG 29",
 *   "6.2 AT 41°") where the app has real rows.
 * - A pixel diff pins whatever shipped. It would have baselined the
 *   verdict stack as correct, which is the bug this was built after.
 * - A pixel diff fails as a red blob. This fails as two lists of strings
 *   and the row that differs, which a person can act on.
 *
 * Values — type steps, colour, radius, motion, icons — are already checked
 * against the contracts by the unit suite (`tokens`, `contrast`,
 * `motion-css`, `icons`). This is the axis those cannot see: composition.
 */

/**
Where the imported boards live. Read-only; see CLAUDE.md.
*/
const BOARDS = new URL("../../design/", import.meta.url);

/**
 * The T1 colour table, as `hex -> role`.
 *
 * **The bridge that makes colour comparable.** The boards are a prototype
 * and style with raw hex; the app compiles to `var(--role)` and resolves
 * to the same hex. Mapping both back to a role name means the diff reads
 * "board `--action`, app `--ink`" rather than two six-digit numbers, and
 * it is why a colour check is possible at all without asking design to
 * restyle 8,728 declarations.
 *
 * Both columns are indexed, so a dark-mode board resolves to the same role
 * as its light twin and one table serves both themes.
 *
 * Parsed from `Theme.dc.html` exactly as `test/ui/contrast.dom.test.tsx`
 * does — the same regex against the same rows, because a second spelling
 * of "what T1 says" is a rival truth.
 */
const T1_ROW =
  /\[\s*'[^']*',\s*'(?<role>--\w[\w-]*)',\s*'(?<light>#[\dA-Fa-f]{6})',\s*'(?<dark>#[\dA-Fa-f]{6})'/gu;

function roleByHex(): Map<string, string> {
  const theme = readFileSync(new URL("Theme.dc.html", BOARDS), "utf8");
  const table = new Map<string, string>();
  for (const match of theme.matchAll(T1_ROW)) {
    const role = match.groups?.role ?? "";
    table.set((match.groups?.light ?? "").toLowerCase(), role);
    table.set((match.groups?.dark ?? "").toLowerCase(), role);
  }
  return table;
}

const ROLE_BY_HEX = roleByHex();

/**
`rgb(11, 11, 14)` -> `#0b0b0e`. Both sides resolve to `rgb()`.
*/
function hexOf(computed: string): string {
  const parts = /rgba?\((\d+),\s*(\d+),\s*(\d+)/u.exec(computed);
  if (parts === null) return computed;
  const channel = (index: number): string =>
    Number(parts[index] ?? 0)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(1)}${channel(2)}${channel(3)}`;
}

/**
 * A colour as its T1 role, or as its hex when it is not one.
 *
 * **An unmapped colour is a finding, not an error.** 93% of colour uses
 * inside the boards' screen frames resolve to a role; the remainder are
 * hover tints T1 has no pair for, pre-round-13 drift, and placeholder
 * hatch fills. Returning the hex rather than throwing keeps those visible
 * in a diff instead of hiding them behind a failure.
 */
export function colorRole(computed: string): string {
  const hex = hexOf(computed);
  return ROLE_BY_HEX.get(hex) ?? hex;
}

/**
One run of text, with where it sits and what it is wearing.
*/
export interface Leaf {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly color: string;
  readonly weight: string;
  readonly size: string;
}

/**
Text leaves grouped into rows by their top edge, each ordered by x.
*/
export type Signature = readonly (readonly string[])[];

/**
 * Runs in the browser, so it may not close over anything in this file.
 *
 * `data-annotation` is skipped wholesale — design marks every caption and
 * commentary with it, which is what lets a screen's own copy be compared
 * without the notes about that copy coming along. Before those markers
 * existed the first spike stripped the last row heuristically.
 */
const EXTRACT = ({
  selector,
  rowHeight,
}: {
  selector: string;
  rowHeight: number;
}): Leaf[] => {
  const root = document.querySelector(selector);
  if (!root) return [];
  const leaves: Leaf[] = [];

  const walk = (element: Element): void => {
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = (node.textContent ?? "").trim().replaceAll(/\s+/gu, " ");
        if (text === "") continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const box = range.getBoundingClientRect();
        if (box.width <= 0 || box.height <= 0) continue;
        const style = getComputedStyle(element);
        leaves.push({
          text,
          x: box.x,
          y: box.y,
          color: style.color,
          weight: style.fontWeight,
          size: style.fontSize,
        });
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      // `HTMLElement`, not `Element`, only so `dataset` is in the type —
      // `unicorn/prefer-dom-node-dataset` rewrites `hasAttribute` to it,
      // and `Element` does not carry it.
      const child = node as HTMLElement;
      if (Object.hasOwn(child.dataset, "annotation")) continue;
      const style = getComputedStyle(child);
      if (style.display === "none" || style.visibility === "hidden") continue;
      walk(child);
    }
  };

  walk(root);

  const base = root.getBoundingClientRect();
  return leaves.map((leaf) => ({
    ...leaf,
    x: Math.round(leaf.x - base.x),
    // Quantised, because "same row" is the question — a one-pixel
    // difference in baseline between two fonts is not a composition
    // difference and must not read as one.
    y: Math.round((leaf.y - base.y) / rowHeight),
  }));
};

/**
Text leaves inside `selector`, ordered top-to-bottom then left-to-right.
*/
export async function leavesOf(
  page: Page,
  selector: string,
  rowHeight = 8,
): Promise<Leaf[]> {
  const leaves = await page.evaluate(EXTRACT, { selector, rowHeight });
  return leaves.toSorted((a, b) => a.y - b.y || a.x - b.x);
}

/**
The same leaves, as rows of plain text — the coarsest useful diff.
*/
export async function signatureOf(
  page: Page,
  selector: string,
  rowHeight = 8,
): Promise<Signature> {
  const rows = new Map<number, string[]>();
  const leaves = await leavesOf(page, selector, rowHeight);
  for (const leaf of leaves) {
    const row = rows.get(leaf.y) ?? [];
    row.push(leaf.text.toUpperCase());
    rows.set(leaf.y, row);
  }
  return [...rows].toSorted((a, b) => a[0] - b[0]).map(([, row]) => row);
}


/**
 * The region's own children, each as the text it contains.
 *
 * **The right granularity for a row of cells, and rows are the wrong
 * one.** Grouping text by its top edge reads a wrapped cell as two rows,
 * and flattening those rows back out is row-major — so a board whose
 * cells wrap ("WAY" / "COLD") and an app whose cells do not produce
 * `WAY A BIT DIALED A BIT WAY COLD COLD …` against `WAY COLD A BIT COLD
 * …`. Same composition, scrambled by a fold.
 *
 * A cell's text content does not care where it folded, which is why the
 * comparison happens here: the elements are the composition, and the
 * wrapping is a consequence of width. `signatureOf` stays for the
 * question rows genuinely answer — "is this one band or a stack".
 */
export async function cellsOf(
  page: Page,
  selector: string,
): Promise<readonly string[]> {
  return page.$$eval(`${selector} > *`, (cells) =>
    cells
      .filter((cell) => {
        const style = getComputedStyle(cell);
        return style.display !== "none" && style.visibility !== "hidden";
      })
      .map((cell) => {
        // **Text nodes joined with a space, not the cell's `textContent`.**
        // The boards separate a cell's two words with a hard `<br />`, and
        // `textContent` concatenates across it to "WAYCOLD" while ours
        // reads "WAY COLD" — a difference in markup reported as a
        // difference in copy. Walking the nodes puts the separator back
        // wherever the markup had a boundary, `<br />` or nested span
        // alike.
        const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
        const words: string[] = [];
        let node = walker.nextNode();
        while (node !== null) {
          const text = (node.textContent ?? "").trim();
          if (text !== "") words.push(text);
          node = walker.nextNode();
        }
        return words.join(" ").replaceAll(/\s+/gu, " ").toUpperCase();
      })
      .filter((text) => text !== ""),
  );
}

/**
 * Opens an artboard with the app's fonts, at the device width.
 *
 * **The fonts are the subtle part.** The boards `<link>` Google Fonts and
 * the app self-hosts; in CI the board's request fails and it falls back to
 * a system face. Different metrics mean different wrap points, so "A BIT
 * COLD" might set on one line for the board and two for the app, and the
 * signature would report a composition difference that is really a font
 * that did not load. Pointing the board at the app's own `/fonts` makes
 * both sides identical, and `document.fonts.ready` makes the wait
 * explicit rather than a timeout.
 */
export async function openBoard(
  page: Page,
  board: string,
  appOrigin: string,
): Promise<void> {
  await page.setViewportSize({ width: 1600, height: 1200 });
  // `.href` straight from the URL: `BOARDS` is already a `file:` URL, so
  // routing through `pathToFileURL(…pathname)` encodes the space in
  // "Product Screens.dc.html" a second time and asks for `%2520`.
  await page.goto(new URL(board, BOARDS).href);
  // `split`/`join` rather than `replaceAll`: a non-literal replacement is
  // a lint error, because `$&` and its siblings are special inside a
  // replacement string and `appOrigin` is a URL that could carry one.
  const faces = readFileSync(
    new URL("../../src/ui/fonts.css", import.meta.url),
    "utf8",
  )
    .split('url("/fonts/')
    .join(`url("${appOrigin}/fonts/`);
  await page.addStyleTag({ content: faces });
  // Not `page.evaluate(() => document.fonts.ready)`:
  // `unicorn/isolated-functions` rejects a callback that reaches
  // `document`, because the callback runs in the browser where this
  // file's scope does not exist. `waitForFunction` takes the same
  // expression as a string.
  await page.waitForFunction("document.fonts.status === 'loaded'");
}

/**
The board's own wrapper for one screen, by the label design gave it.
*/
export function screen(label: string): string {
  return `[data-screen-label^="${label}"]`;
}

/**
A named region inside a screen — design's `data-part`, our `data-slot`.
*/
export function part(label: string, name: string): string {
  return `${screen(label)} [data-part="${name}"]`;
}
