import type { Page } from "@playwright/test";

import type { A11y } from "./a11y";
import { expect, test } from "./a11y";

/**
 * The fixture's own check: a page with one of each problem planted, so a
 * green suite means the checks ran rather than that nothing was looked at.
 *
 * Served by `page.route` on the app's origin, which is the only origin
 * the checker runs on, so this needs no app route of its own. The page
 * is otherwise clean (a title, a language, a landmark), so the findings
 * are exactly the planted ones.
 */
test.use({ a11yMode: "collect" });

const PROBE = "/__a11y-probe";

const PLANTED = `<!doctype html>
<html lang="en">
<head><title>Probe</title></head>
<body>
<main>
  <h1>Probe</h1>
  <img src="/x.png">
  <button style="width:60px;height:60px"></button>
  <p style="color:#eeeeee;background:#ffffff">grey on white</p>
  <button style="width:20px;height:20px">x</button>
  <h2>7<!-- --> <!-- -->waiting</h2>
  <label style="display:flex;width:200px;height:48px"><input type="checkbox">Jacket</label>
  <p>Read <a href="/terms">the terms</a> first.</p>
  <p><a data-target="inline" href="/credit" style="display:inline-block">Credit</a></p>
  <style>.seam{position:relative;height:32px;width:80px}.seam::before{content:"";position:absolute;inset:-6px 0}</style>
  <button class="seam">Chip</button>
  <input type="file" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)" aria-label="Photo">
</main>
</body>
</html>`;

test("finds each planted problem, and only those", async ({ page, a11y }) => {
  await page.route(`**${PROBE}`, (route) =>
    route.fulfill({ contentType: "text/html", body: PLANTED }),
  );
  await page.goto(PROBE);
  await a11y.checkNow();

  const found = a11y.findings();
  expect(
    found
      .map((finding) => finding.rule)
      .toSorted((one, other) => one.localeCompare(other)),
  ).toStrictEqual([
    "button-name",
    "color-contrast",
    "image-alt",
    "name-space",
    "target-44",
  ]);
  // The small one is the 20px button, not the label-wrapped checkbox, the
  // inline links, the 32px chip whose ::before makes 44, or the hidden
  // file input.
  expect(found.find((finding) => finding.rule === "target-44")?.node).toBe(
    "button",
  );
  expect(found.find((finding) => finding.rule === "name-space")?.node).toBe(
    "h#",
  );
  expect(found.every((finding) => finding.route === PROBE)).toBe(true);
});

test("checks before an action, without being asked", async ({ page, a11y }) => {
  await page.route(`**${PROBE}`, (route) =>
    route.fulfill({ contentType: "text/html", body: PLANTED }),
  );
  await page.goto(PROBE);
  await page.mouse.wheel(0, 1);

  expect(a11y.findings().map((finding) => finding.rule)).toContain("image-alt");
});

/**
 * Step 2's rules: what the end-of-test walk and reflow check report.
 */
const END_RULES = new Set([
  "focus-ring",
  "focus-obscured",
  "focus-trap",
  "tab-order",
  "tab-unreached",
  "reflow",
  "image-alt",
]);

const RING = `<style>
  :focus-visible { outline: 2px solid #000; outline-offset: 2px }
  .field-box:has(:focus-visible) { outline: 2px solid #000 }
  .field-box :focus-visible, .noring:focus-visible { outline: none }
</style>`;

/*
 * The walk's problems, one each: a covered control, a ring taken off, a
 * positive tabindex, a mouse-only link and a clickable <div>. Around
 * them, what must pass: a radio group (Tab reaches one), a field-box
 * input whose box draws the ring, and a hidden file input.
 */
const WALK = `<!doctype html>
<html lang="en"><head><title>Walk</title>${RING}</head>
<body><main>
  <div style="position:fixed;inset:0 0 auto 0;height:100px;background:#fff;z-index:2">Bar</div>
  <button class="under" style="position:absolute;top:10px;left:10px">Under</button>
  <div style="margin-top:120px">
    <h1>Walk</h1>
    <button class="one">One</button>
    <button class="noring">Ringless</button>
    <button class="jump" tabindex="2">Jump</button>
    <div class="fake" style="cursor:pointer">Fake</div>
    <a href="/x" tabindex="-1">Mouse only</a>
    <label><input type="radio" name="pick">A</label>
    <label><input type="radio" name="pick">B</label>
    <div class="field-box"><input aria-label="Field"></div>
    <input type="date" aria-label="Day">
    <input type="file" tabindex="-1" aria-label="Photo" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)">
  </div>
</main></body></html>`;

/*
 * A control that keeps Tab for itself, and the button the walk then
 * never reaches.
 */
const TRAP = `<!doctype html>
<html lang="en"><head><title>Trap</title>${RING}</head>
<body><main>
  <h1>Trap</h1>
  <button class="before">Before</button>
  <input aria-label="Trap" id="trap">
  <button class="after">After</button>
  <script>
    document.getElementById("trap").addEventListener("keydown", (event) => {
      if (event.key === "Tab") event.preventDefault();
    });
  </script>
</main></body></html>`;

/*
 * Au4's race, made certain: the page moves focus to Try again on a
 * motion token's timer, past a run of fields long enough that a walk
 * started at once is still among them when the move lands.
 */
const LATE = `<!doctype html>
<html lang="en"><head><title>Late</title>${RING}</head>
<body><main>
  <h1>Late</h1>
  ${Array.from({ length: 40 }, (_, index) => `<button class="field">Field ${String(index)}</button>`).join("\n  ")}
  <button id="retry">Try again</button>
  <button class="submit">Log in</button>
  <script>
    setTimeout(() => document.getElementById("retry").focus(), 90);
  </script>
</main></body></html>`;

/*
 * Only the other width shows the image, and only 320 makes the box too
 * wide. The strip scrolls on its own, which reflow allows.
 */
const WIDTHS = `<!doctype html>
<html lang="en"><head><title>Widths</title>${RING}
<style>.phone { display: none } @media (max-width: 600px) { .phone { display: block } }</style>
</head>
<body><main>
  <h1>Widths</h1>
  <img class="phone" src="/x.png">
  <div class="wide" style="width:400px">Wide</div>
  <p class="word">Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa</p>
  <div class="strip" style="overflow-x:auto;width:200px"><div style="width:600px">Strip</div></div>
</main></body></html>`;

async function endFindings(
  page: Page,
  a11y: A11y,
  body: string,
): Promise<string[]> {
  await page.route(`**${PROBE}`, (route) =>
    route.fulfill({ contentType: "text/html", body }),
  );
  await page.goto(PROBE);
  await a11y.endOfTest();
  return a11y
    .findings()
    .filter((finding) => END_RULES.has(finding.rule))
    .map((finding) => `${finding.rule} ${finding.node}`)
    .toSorted((one, other) => one.localeCompare(other));
}

test("the Tab walk finds each planted problem, and only those", async ({
  page,
  a11y,
}) => {
  expect(await endFindings(page, a11y, WALK)).toStrictEqual([
    "focus-obscured button.under",
    "focus-ring button.noring",
    "tab-order button.jump",
    'tab-unreached a[href="/x"]',
    "tab-unreached div.fake",
  ]);
});

test("the Tab walk reports a trap and what it cut off", async ({
  page,
  a11y,
}) => {
  expect(await endFindings(page, a11y, TRAP)).toStrictEqual([
    'focus-trap input[aria-label="Trap"]',
    "tab-unreached button.after",
  ]);
});

test("the Tab walk waits out the app's own late focus move", async ({
  page,
  a11y,
}) => {
  expect(await endFindings(page, a11y, LATE)).toStrictEqual([]);
});

test("the other width and 320px are checked", async ({ page, a11y }) => {
  expect(await endFindings(page, a11y, WIDTHS)).toStrictEqual([
    "image-alt img.phone",
    "reflow div.wide",
  ]);
});

test("reflow names a word too long to wrap", async ({ page, a11y }) => {
  expect(
    await endFindings(
      page,
      a11y,
      WIDTHS.replace('<div class="wide" style="width:400px">Wide</div>', ""),
    ),
  ).toStrictEqual(["image-alt img.phone", "reflow p.word"]);
});
