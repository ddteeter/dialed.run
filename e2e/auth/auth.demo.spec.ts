/**
 * Covers: Au2 in the invite stage (the code first, a code that doesn't
 * work), Au5 (request access and its receipt), D7 (the request, Send
 * invite), `/join` (the invite link fills the code), Au2 (create account),
 * Au4 (check your email, Resend), the confirm link's landing, O0 (pick a
 * handle, a taken one first), Au3 (wrong password), ACC-4 (forgot it, the
 * reset link, a new password), Au1 (log in), sign out from the settings
 * index — one journey, one video.
 *
 * Exactly one test() per demo spec. A second test here would record a
 * second video beside the one the reviewer is meant to watch; standalone
 * assertions belong in a sibling *.spec.ts (see home.spec.ts).
 */
import { INVITE_COPY } from "../../src/lib/access";
import { signInAsOperator } from "../desk/operator";
import { expect, scene, test } from "../support/demo";
import { confirmLinkFor, resetLinkFor } from "../support/email-links";
import { turnstileAnswered } from "../support/invites";

/** Layout stamps html[data-hydrated] once React attaches; driving
 *  controlled inputs before that races hydration's state reset. */
async function hydrated(page: import("@playwright/test").Page): Promise<void> {
  await page
    .locator('html[data-hydrated="true"]')
    .waitFor({ state: "attached" });
}

/**
Not a secret: a throwaway account on the local dev database.
*/
const PASSPHRASE = ["a", "long", "enough", "passphrase"].join("-");

test("request access -> an invite from the Desk -> create an account -> sign out -> a guarded page -> a wrong password -> log in and back", async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(240_000);
  const email = `smoke-${String(Date.now())}@example.com`;
  await page.goto("/auth/signup");
  await hydrated(page);

  // ACC-5 (round 26 #20): sign-up is invite-only, email and Google alike.
  await scene(page, "Au2 · invite-only for now: the code comes first");
  await expect(
    page.getByRole("heading", { name: "Create account" }),
  ).toBeVisible();
  await expect(page.locator("[data-slot='tab-bar']")).toHaveCount(0);
  await expect(
    page.getByText("dialed.run is invite-only for now."),
  ).toBeVisible();

  await scene(page, "A code that doesn't work is marked on the code");
  await page.getByLabel("Invite code").fill("DIAL-ZZZZ");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSPHRASE);
  await turnstileAnswered(page);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText(INVITE_COPY.invalid)).toBeVisible({
    timeout: 15_000,
  });

  await scene(page, "No code? Au5 · Request access");
  await page.getByRole("link", { name: "Request access" }).click();
  await expect(page).toHaveURL(/\/account\/request-access/u, {
    timeout: 15_000,
  });
  await hydrated(page);
  await page.getByLabel("Email").fill(email);
  await page
    .getByLabel("A note · optional")
    .fill("Winter runner. Maya said to ask.");
  await turnstileAnswered(page);
  await page.getByRole("button", { name: "Request access" }).click();
  await scene(page, "One receipt, for a new, repeat or registered address");
  await expect(
    page.getByRole("heading", { name: "You're on the list" }),
  ).toBeVisible({ timeout: 15_000 });

  await scene(page, "D7 · Access: the request waits; Send invite mints a code");
  await signInAsOperator(page);
  await page.goto("/desk/access");
  await hydrated(page);
  const request = page.getByRole("listitem").filter({ hasText: email });
  await expect(request).toContainText("Winter runner. Maya said to ask.");
  await request.getByRole("button", { name: "Send invite" }).click();
  const invite = page
    .getByRole("listitem")
    .filter({ hasText: `${email} (request)` });
  await expect(invite).toContainText("0/1", { timeout: 15_000 });
  const code = /DIAL-[2-9A-HJ-NP-Z]{4}/u.exec(
    (await invite.textContent()) ?? "",
  )?.[0];
  if (code === undefined) throw new Error("no code on the invited row");

  // The invite link, opened signed out: `/join` fills the code in.
  await scene(page, "The invite link fills the code in");
  await page.context().clearCookies();
  await page.goto(`/join?code=${code}`);
  await expect(page).toHaveURL(/\/auth\/signup\?code=/u, { timeout: 15_000 });
  await hydrated(page);
  await expect(page.getByLabel("Invite code")).toHaveValue(code);

  // OPS-15 (decision D-48): from the keyboard, a field's ring lies on its
  // border — one line, not a border and a ring beyond it.
  await page.keyboard.press("Shift");
  await page.getByLabel("Email").focus();
  await scene(page, "A focused field: one line, the ring on its border");
  const ringOffset = await page
    .getByLabel("Email")
    .evaluate(
      (input) =>
        getComputedStyle(input.closest(".field-box") ?? input).outlineOffset,
    );
  expect(ringOffset).toBe("-1px");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSPHRASE);
  await page.getByRole("button", { name: "Show" }).click();
  await expect(page.getByLabel("Password")).toHaveAttribute("type", "text");
  await turnstileAnswered(page);
  await page.getByRole("button", { name: "Create account" }).click();

  // Round 26 #11: every email sign-up ends on Au4, new address or not, and
  // signs nobody in — the page must not tell the two apart.
  await scene(page, "Au4 · Check your email, for a new address or a known one");
  await expect(page).toHaveURL(/\/account\/check-email/u, { timeout: 15_000 });
  await hydrated(page);
  await expect(
    page.getByRole("heading", { name: "Check your email" }),
  ).toBeVisible();
  await expect(page.getByText(`We sent a link to ${email}.`)).toBeVisible();
  await page.getByRole("button", { name: "Resend link" }).click();
  await scene(page, "Resend: a new link, and the old one stops working");
  await expect(page.getByText(/^Sent ✓/u)).toBeVisible({ timeout: 15_000 });

  // The link, opened from the inbox (e2e/support/email-links).
  await scene(page, "The link confirms the address");
  await page.goto(await confirmLinkFor(email));
  await expect(
    page.getByRole("heading", { name: "Email confirmed" }),
  ).toBeVisible({ timeout: 15_000 });
  await page.goto("/auth/login");
  await hydrated(page);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSPHRASE);
  await page.getByRole("button", { name: "Log in" }).click();

  // Round 26 #7: every new account picks its handle at O0, the first
  // onboarding step. A reserved one reads as taken, with nothing to suggest.
  await scene(page, "O0 · What should runners call you?");
  await expect(page).toHaveURL(/\/onboarding\/handle/u, { timeout: 15_000 });
  await hydrated(page);
  await expect(page.getByText("Step 1 of 4")).toBeVisible();
  const handleField = page.getByRole("textbox", { name: "Username" });
  await handleField.fill("Admin");
  await expect(handleField).toHaveValue("admin");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("@admin is taken. Try another.")).toBeVisible({
    timeout: 15_000,
  });
  await scene(page, "A free handle goes on to O1");
  await handleField.fill(`smoke_${String(Date.now()).slice(-8)}`);
  await page.getByRole("button", { name: "Next" }).click();

  // O1 next (D-52); the close screen's own link is the way a runner first
  // leaves onboarding.
  await expect(page).toHaveURL(/\/onboarding\/calibrate/u, { timeout: 15_000 });
  await page.goto("/onboarding/done");
  await page.getByRole("link", { name: "Done for now" }).click();

  // Sign out lives at the foot of the settings index now (U1).
  await scene(page, "Sign out, from the foot of settings");
  await page.goto("/onboarding/settings");
  await hydrated(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/u, { timeout: 15_000 });
  await expect(
    page.getByRole("link", { name: "Create account" }),
  ).toBeVisible();

  // A guarded page, signed out, goes to log-in carrying the way back.
  await scene(page, "Signed out, the Call sends you to log in and back");
  await page.goto("/call");
  await expect(page).toHaveURL(/\/auth\/login\?redirect=%2Fcall$/u, {
    timeout: 15_000,
  });
  await hydrated(page);

  await scene(page, "Au3 · a wrong password is marked on Password");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(`${PASSPHRASE}-not`);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(
    page.getByText("That password doesn't match this email."),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("status")).toHaveText(
    "Not signed in. One field needs a fix.",
  );

  // ACC-4: forgotten, it is reset by email.
  await scene(page, "Forgot it? A reset link goes to the address");
  await page.getByRole("link", { name: "Forgot it?" }).click();
  await expect(page).toHaveURL(/\/account\/forgot/u, { timeout: 15_000 });
  await expect(
    page.getByRole("heading", { name: "Forgot your password?" }),
  ).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send link" }).click();
  await expect(
    page.getByRole("heading", { name: "Check your inbox" }),
  ).toBeVisible({ timeout: 15_000 });

  await scene(page, "The reset link sets a new password");
  await page.goto(await resetLinkFor(email));
  await hydrated(page);
  await page.getByLabel("New password").fill(`${PASSPHRASE}-new`);
  await page.getByRole("button", { name: "Set password" }).click();
  await expect(page.getByRole("heading", { name: "Password set" })).toBeVisible(
    { timeout: 15_000 },
  );

  await scene(page, "Au1 · the new one logs in");
  await page.goto("/auth/login?redirect=%2Fcall");
  await hydrated(page);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(`${PASSPHRASE}-new`);
  await page.getByRole("button", { name: "Log in" }).click();
  // Back where the runner was going, not home.
  await expect(page).toHaveURL(/\/call$/u, { timeout: 15_000 });
});
