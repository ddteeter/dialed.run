/**
 * Covers: O1 (calibrate), O3 (the one list), P3 (now go run), O6 (the Call
 * teaser) — one journey, one video.
 *
 * The journey is the packet's own done-criterion read literally: a fresh
 * account reaches "now go run" with a real closet, and the Call tab then
 * shows an honest empty ladder rather than a promise. Both halves matter
 * and neither is visible in a diff — the ladder in particular is a screen
 * whose whole job is to *not* make a recommendation.
 *
 * Nothing is seeded. That is the point of the demo: this is the path a
 * person who just signed up actually walks, and the only state it depends
 * on is what they type into it.
 */
import { expect, test } from "../support/demo";

/** Layout stamps html[data-hydrated] once React attaches; driving
 *  controlled inputs before that races hydration's state reset. */
async function hydrated(page: import("@playwright/test").Page): Promise<void> {
  await page
    .locator('html[data-hydrated="true"]')
    .waitFor({ state: "attached" });
}

test("calibrate -> tap what you own -> now go run -> an honest ladder", async ({
  page,
}, testInfo) => {
  // ~30 actions at the demo project's slowMo 1800 is ~54s of pacing before
  // any real work, past Playwright's 30s default. Same bump as the closet
  // and run-logging demos.
  testInfo.setTimeout(150_000);
  const email = `demo-${String(Date.now())}@example.com`;

  await page.goto("/auth/signup");
  await hydrated(page);
  await page.getByLabel("Name").fill("Demo Runner");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("a-long-enough-password");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByText(email)).toBeVisible({ timeout: 15_000 });

  // O1. One question is the whole requirement — the location ask is
  // refusable and the units are a guess the runner can change, so the demo
  // answers the one and types a city rather than granting geolocation.
  // That is deliberately the *worst* path: it is the one a denied
  // permission produces, and it has to work.
  await page.goto("/onboarding/calibrate");
  await hydrated(page);
  await page.getByLabel("Run a little cold").check();
  await page.getByLabel("Where you run").fill("Minneapolis");
  await page.getByRole("button", { name: "Start running" }).click();

  // O3. Every row is on offer and nothing arrives ticked — the counter
  // starts at zero and counts taps, which is the fact design round 6
  // changed and the artboard used to contradict.
  await expect(page.getByText("Closet: 0 pieces")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("Tap what you own")).toBeVisible();

  for (const piece of [
    "Running tights",
    "Merino base layer",
    "Beanie",
    "Running gloves",
    "Short sleeve tee",
  ]) {
    await page.getByRole("checkbox", { name: piece }).check();
  }
  await expect(page.getByText("Closet: 5 pieces")).toBeVisible();

  // The remainder is one tap behind a disclosure that states its own
  // count — never absent, whatever the climate band decided.
  await page.getByRole("button", { name: /Everything else/ }).click();
  await page.getByRole("checkbox", { name: "Running socks" }).check();

  // "Enough to start" is advice and appears at six. Next has been live
  // since the first tap, which is why this is a caption and not a gate.
  await expect(page.getByText("Enough to start")).toBeVisible();
  await expect(page.getByText("Closet: 6 pieces")).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();

  // P3. An instruction and a promise, not a payoff — there is nothing to
  // celebrate yet and the screen does not pretend otherwise.
  await expect(
    page.getByRole("heading", { name: "Now go run." }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByText(/verdicts we start making the call for you/),
  ).toBeVisible();

  // The closet the tap list actually created, six real rows.
  await page.goto("/closet");
  await hydrated(page);
  await expect(page.getByRole("heading", { name: "Beanie" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Running tights" })).toBeVisible();

  // O6. The teaser with no verdicts behind it: it says it is listening, and
  // it makes no call. A recommendation here would be the one thing this
  // screen exists to avoid shipping.
  await page.goto("/call");
  await hydrated(page);
  await expect(page.getByText(/Logging now, calling later/)).toBeVisible();
});
