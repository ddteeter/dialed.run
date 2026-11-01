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
