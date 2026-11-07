/**
 * Walkthrough · the first run (design 180, step 5): an invite link, a new
 * account, the confirm email, a handle, onboarding, and the closet it
 * leaves behind. The sign-up is the story, so this films it rather than
 * taking the walkthrough fixture's runner; the auth and onboarding
 * journeys (`e2e/auth/`, `e2e/onboarding/`) carry the edge cases.
 */
import { expect, hydrated, scene, test, typeSlowly } from "../support/demo";
import { confirmLinkFor } from "../support/email-links";
import { ensureInviteCode, turnstileAnswered } from "../support/invites";

/**
Not a secret: a throwaway account on the local dev database.
*/
const PASSPHRASE = ["a", "long", "enough", "passphrase"].join("-");

test("the first run: an invite, an account, a handle, and a closet to start from", async ({
  page,
}, testInfo) => {
  // Recording pace is not a latency budget; this catches a hang.
  testInfo.setTimeout(400_000);
  // Both widths sign up, one after the other: an address each.
  const width = testInfo.project.name.endsWith("phone") ? "p" : "d";
  const handle = `new_${width}${String(Date.now()).slice(-7)}`;
  const email = `${handle}@example.com`;
  const code = await ensureInviteCode();

  await page.goto(`/join?code=${code}`);
  await expect(page).toHaveURL(/\/auth\/signup\?code=/u, { timeout: 15_000 });
  await hydrated(page);
  await expect(
    page.getByText("dialed.run is invite-only for now."),
  ).toBeVisible();
  await expect(page.getByLabel("Invite code")).toHaveValue(code);
  await scene(page, "Invite-only · the link brings the code", {
    say: "dialed.run is invite-only for now. A friend's invite link opens sign-up with the code already filled in, so there's nothing to copy.",
  });

  await expect(
    page.getByText("dialed.run is for runners 18 and over."),
  ).toBeVisible();
  await scene(page, "Date of birth · for runners 18 and over", {
    say: "It asks everyone for a date of birth, because dialed.run is for runners 18 and over. I'll enter mine.",
  });
  // The platform's date control, not a text box: it takes the date whole.
  await page.getByLabel("Date of birth").fill("1990-04-21");
  await expect(page.getByText("At least 10 characters.")).toBeVisible();
  await scene(page, "Email and a password", {
    say: "Then an email address and a password. The form says the rule up front: at least ten characters.",
  });
  await typeSlowly(page.getByLabel("Email"), email);
  await typeSlowly(page.getByLabel("Password"), PASSPHRASE);
  await turnstileAnswered(page);
  const totals = page.getByText(
    /^By creating an account you agree to the Terms.*Your runs count, without your name, in totals like the guides\. You can turn that off in Settings\.$/u,
  );
  await totals.scrollIntoViewIfNeeded();
  await expect(totals).toBeVisible();
  await scene(page, "No checkbox · the totals, said up front", {
    say: "There's no checkbox to tick. The lines under the form say what creating the account agrees to, including that your runs count, without your name, in totals like the guides, and that you can turn that off. I'll create the account.",
  });
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/account\/check-email/u, { timeout: 15_000 });
  await hydrated(page);
  await expect(
    page.getByRole("heading", { name: "Check your email" }),
  ).toBeVisible();
  await expect(page.getByText(`We sent a link to ${email}.`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Resend link" })).toBeVisible();
  await scene(page, "Check your email · one link to confirm", {
    say: "Creating the account sends a link to that address. The screen says where it went, and can send it again if it doesn't arrive.",
  });

  // The link, opened from the inbox (e2e/support/email-links).
  await page.goto(await confirmLinkFor(email));
  await expect(
    page.getByRole("heading", { name: "Email confirmed" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByText("Your runs can go on the feed now."),
  ).toBeVisible();
  await scene(page, "Confirmed · runs can go on the feed", {
    say: "I'll open the link from the inbox. It confirms the address, and from now on this runner's runs can be shared. Then I'll open the feed.",
  });

  // Signed out still: the feed asks for a log-in, then sends a new
  // account to pick its handle first.
  await page.getByRole("link", { name: "Open the feed" }).click();
  await expect(page).toHaveURL(/\/auth\/login/u, { timeout: 15_000 });
  await hydrated(page);
  await scene(page, "Log in · the same email and password", {
    say: "This browser isn't signed in yet, so opening the feed asks me to log in. I'll use the same email and password.",
  });
  await typeSlowly(page.getByLabel("Email"), email);
  await typeSlowly(page.getByLabel("Password"), PASSPHRASE);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/onboarding\/handle/u, { timeout: 15_000 });
  await hydrated(page);
  await expect(page.getByText("Step 1 of 4")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "What should runners call you?" }),
  ).toBeVisible();
  await scene(page, "Step 1 · a handle runners know you by", {
    say: "A new account goes straight to setup. Step one of four is a handle: the name other runners find and follow you by.",
  });
  await scene(page, "Typing a handle", {
    say: "I'll type one, and go on with Next.",
  });
  await typeSlowly(page.getByRole("textbox", { name: "Username" }), handle);
  await page.getByRole("button", { name: "Next" }).click();

  await expect(page).toHaveURL(/\/onboarding\/calibrate/u, {
    timeout: 15_000,
  });
  await hydrated(page);
  const thermal = page.getByRole("group", {
    name: "Compared to people you run with, do you run warm or cold?",
  });
  await expect(thermal).toBeVisible();
  await scene(page, "One question · do you run warm or cold?", {
    say: "Then one question: compared to the people you run with, do you run warm or cold? It is the only one this screen needs answered.",
  });
  await expect(
    page.getByText(
      "The offset is visible on purpose. You'll see it change as we learn.",
    ),
  ).toBeVisible();
  await expect(thermal).toContainText(/[+−]\d+°/u);
  await scene(page, "An offset you can see", {
    say: "Each answer shows the offset it starts you with, on purpose: as your verdicts come in, you'll watch it change. I tend to run a little cold, so I'll pick that, and start running.",
  });
  await page.getByLabel(/^Run a little cold/u).check();
  await page.getByRole("button", { name: "Start running" }).click();

  // The first visit to the tap list compiles its server function on the
  // dev server; a long wait here is for catching a hang, not a budget.
  await expect(page.getByText("Closet: 0 pieces")).toBeVisible({
    timeout: 60_000,
  });
  await hydrated(page);
  await expect(page.getByText("Tap what you own")).toBeVisible();
  await expect(
    page.getByText("Common in your climate · tap to add"),
  ).toBeVisible();
  await scene(page, "The Closet · common pieces to tap", {
    say: "Next, the Closet. Rather than a form per piece, it offers the pieces common in your climate. Nothing arrives ticked. I'll tap the tights, a merino base layer, and gloves.",
  });
  // Checked after every tap: the count is what the tap changes.
  const tapped = ["Running tights", "Merino base layer", "Running gloves"];
  for (const [index, piece] of tapped.entries()) {
    await page.getByRole("checkbox", { name: piece }).check();
    await expect(
      page.getByText(`Closet: ${String(index + 1)} pieces`),
    ).toBeVisible();
  }
  await scene(page, "Three taps · three pieces", {
    say: "The count goes up with each tap: three pieces.",
  });
  await page.getByRole("button", { name: "Next" }).click();

  // Naming each piece as a product can wait for another day.
  await expect(page.getByText(/A category can.t remember/u)).toBeVisible({
    timeout: 15_000,
  });
  await scene(page, "Name them · or skip for now", {
    say: "The next step offers to name each piece as a real product, because a category can't remember how it worked and a product can. That can wait, so I'll skip it for now.",
  });
  await page.getByRole("button", { name: "Skip for now" }).click();

  await expect(page.getByRole("heading", { name: "Now go run." })).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByText(
      "Next time you finish a run, upload it and tell us what you wore. That’s the whole loop.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText(/verdicts we start making the call for you/u),
  ).toBeVisible();
  await scene(page, "Now go run · the whole loop", {
    say: "And that's it. The last screen is an instruction: after a run, upload it and say what you wore. After enough verdicts, the Call starts deciding for you.",
  });
  await scene(page, "Done for now · to the Closet", {
    say: "I'll choose Done for now, and open the Closet from home.",
  });

  await page.getByRole("link", { name: "Done for now" }).click();
  await expect(page).toHaveURL(/\/$/u, { timeout: 15_000 });
  await hydrated(page);
  await page
    .getByRole("link", { name: "Your closet" })
    .filter({ visible: true })
    .click();
  await expect(page).toHaveURL(/\/closet$/u, { timeout: 15_000 });
  await hydrated(page);
  await expect(page.getByRole("heading", { name: "3 pieces" })).toBeVisible();
  for (const piece of tapped) {
    const tile = page.getByRole("link", { name: new RegExp(piece, "u") });
    await expect(tile.locator("[data-part='tile-record']")).toHaveText(
      "No runs yet",
      { ignoreCase: true },
    );
  }
  await scene(page, "The closet it starts from · three pieces", {
    say: "The Closet is ready for the first run: the three pieces I tapped, each one waiting for its record.",
  });
});
