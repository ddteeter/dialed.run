/**
 * Covers: Settings › Account (ACC-7, ACC-8), Change password and its
 * lockout (R-124), Settings › Notifications (ACC-11), the unsubscribe link
 * and its landing (round 26 #19), Sign out everywhere, Export your data
 * (ACC-10: Get a copy, Preparing, the queued ZIP, Download, a dead link), Delete account with Keep inside
 * the week (ACC-9; round 27 #14, round 28 #12), the way back from Google
 * and NOT KEPT once the purge has begun (round 40 C1), "Confirm your email first"
 * from Change email while unconfirmed (round 29 #11–12), and O0's re-pick after a
 * moderator's rename (ACC-12; round 27 #16) — one journey, one video.
 *
 * Exactly one test() per demo spec (see e2e/auth/auth.demo.spec.ts).
 */
import type { Page } from "@playwright/test";
import { eq } from "drizzle-orm";

import { user } from "../../src/db/schema-auth";
import {
  passwordAttempts,
  userProfiles,
  usernameHistory,
} from "../../src/db/schema-core";
import { nowSeconds } from "../../src/lib/now";
import { expect, scene, test } from "../support/demo";
import { confirmLinkFor, unsubscribeLinkFor } from "../support/email-links";
import { ensureInviteCode, turnstileAnswered } from "../support/invites";
import { withLocalDb } from "../support/local-db";

/**
 * Keep's answer once the purge has begun, as the server sends it. The
 * state is a race on the server — the purge's claim also deletes the
 * runner's sessions, so it lands only between Keep's gate and its batch —
 * which a demo cannot time, so this stands the answer in for it.
 */
async function keepAnswersTooLate(page: Page): Promise<void> {
  await page.route(
    (url) =>
      url.pathname.startsWith("/_serverFn/") &&
      Buffer.from(url.pathname.slice("/_serverFn/".length), "base64url")
        .toString()
        .includes("keepAccountFn"),
    (route) =>
      route.fulfill({
        contentType: "application/json",
        // What tells TanStack Start's client the body is its own serialized
        // result rather than a raw Response.
        headers: { "x-tss-serialized": "true" },
        body: JSON.stringify({
          t: 10,
          i: 0,
          p: {
            k: ["result", "error", "context"],
            v: [
              { t: 1, s: "too-late" },
              { t: 2, s: 1 },
              { t: 11, i: 1, p: { k: [], v: [] }, o: 0 },
            ],
          },
          o: 0,
        }),
      }),
    { times: 1 },
  );
}

async function hydrated(page: Page): Promise<void> {
  await page
    .locator('html[data-hydrated="true"]')
    .waitFor({ state: "attached" });
}

/**
 * The demo runner's address, confirmed or not (round 26 #11): flipped for
 * the unconfirmed beat, and always flipped back, because the rest of the
 * journey is a confirmed runner's.
 */
async function setEmailConfirmed(
  email: string,
  isConfirmed: boolean,
): Promise<void> {
  await withLocalDb(async ({ core }) => {
    await core
      .update(user)
      .set({ emailVerified: isConfirmed })
      .where(eq(user.email, email));
  });
}

/**
Not a secret: a throwaway account on the local dev database.
*/
const PASSPHRASE = ["an", "account", "demo", "passphrase"].join("-");

test("account settings -> change password -> reminder emails off and on -> sign out everywhere -> export -> delete and keep", async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(420_000);
  const email = `account-${String(Date.now())}@example.com`;

  // A confirmed runner with a handle, the way the auth demo makes one.
  await page.goto("/auth/signup");
  await hydrated(page);
  await page.getByLabel("Invite code").fill(await ensureInviteCode());
  await page.getByLabel("Date of birth").fill("1990-04-21");
  await turnstileAnswered(page);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSPHRASE);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/account\/check-email/u, { timeout: 15_000 });
  await page.goto(await confirmLinkFor(email));
  await expect(
    page.getByRole("heading", { name: "Email confirmed" }),
  ).toBeVisible({ timeout: 15_000 });
  await page.goto("/auth/login");
  await hydrated(page);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSPHRASE);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/onboarding\/handle/u, { timeout: 15_000 });
  await hydrated(page);
  const handle = `acct_${String(Date.now()).slice(-8)}`;
  await page.getByRole("textbox", { name: "Username" }).fill(handle);
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page).toHaveURL(/\/onboarding\/calibrate/u, { timeout: 15_000 });

  await scene(
    page,
    "Settings › Account: the address, the handle, the password",
  );
  await page.goto("/onboarding/settings");
  await hydrated(page);
  await page.getByRole("link", { name: /^Account/u }).click();
  await expect(page).toHaveURL(/\/account\/sign-in/u, { timeout: 15_000 });
  await hydrated(page);
  await expect(page.getByRole("link", { name: /^Email/u })).toContainText(
    email,
  );

  await scene(page, "Change password: the current one, then the new one");
  await page.getByRole("link", { name: /^Password/u }).click();
  await expect(page.getByRole("heading", { name: "Password" })).toBeVisible();
  // Task 126 PR B: both password boxes are a text field's 50, their Show
  // targets inside rather than growing them.
  for (const label of ["Current password", "New password"]) {
    expect(
      await page
        .getByLabel(label)
        .evaluate(
          (input) =>
            (input.closest(".field-box") ?? input).getBoundingClientRect()
              .height,
        ),
    ).toBe(50);
  }
  await page.getByLabel("Current password").fill(PASSPHRASE);
  await page.getByLabel("New password").fill(`${PASSPHRASE}-2`);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.locator("form").getByRole("status")).toHaveText(
    "Password changed. Every other device was signed out.",
    { timeout: 15_000 },
  );

  // R-124: the change is the server's now, so the per-runner count on
  // tries at the current password reaches it, and the sixth try reads
  // round 28 #10's field message rather than the band's rate limit.
  await scene(page, "Change password: five wrong tries, then the wait");
  // The success clears both fields; filling before it does would be wiped.
  await expect(page.getByLabel("Current password")).toHaveValue("");
  const changeButton = page.getByRole("button", { name: "Change password" });
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await page.getByLabel("Current password").fill(`${PASSPHRASE}-wrong`);
    await page.getByLabel("New password").fill(`${PASSPHRASE}-3`);
    // Each try waits for the server's answer: a press while one is in
    // flight is dropped by the double-submit guard, and is not counted.
    const answered = page.waitForResponse((response) =>
      response.url().includes("/_serverFn/"),
    );
    await changeButton.click();
    await answered;
    await expect(
      page.getByText("That's not your current password."),
    ).toBeVisible({ timeout: 15_000 });
  }
  await page.getByLabel("Current password").fill(`${PASSPHRASE}-2`);
  await changeButton.click();
  await expect(
    page.getByText(/^That's 5 wrong tries\. You can try again at .+\.$/u),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel("Current password")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  // The rest of the journey proves the password again (Delete account),
  // so the window is closed here rather than waited out.
  await withLocalDb(async ({ core }) => {
    const [row] = await core
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email));
    await core
      .delete(passwordAttempts)
      .where(eq(passwordAttempts.userId, row?.id ?? ""));
  });

  // Round 29 #11–12: unconfirmed, Change email is refused into "Confirm
  // your email first", which leads with the email change's own sentence
  // and offers Resend as its outline pill, Not now focused.
  await scene(page, "Unconfirmed: Change email asks to confirm this address");
  await setEmailConfirmed(email, false);
  try {
    await page.goto("/account/email");
    await expect(page.getByRole("heading", { name: "Email" })).toBeVisible({
      timeout: 15_000,
    });
    await hydrated(page);
    await page.getByLabel("New email").fill(`moved-${email}`);
    await page.getByLabel("Current password").fill(`${PASSPHRASE}-2`);
    await page.getByRole("button", { name: "Send link" }).click();
    const confirmFirst = page.getByRole("dialog", {
      name: "Confirm your email first",
    });
    await expect(confirmFirst).toContainText(
      "Confirm this address before you change it.",
      { timeout: 15_000 },
    );
    await expect(confirmFirst).toContainText(`We sent a link to ${email}.`);
    await expect(
      confirmFirst.getByRole("button", { name: "Resend link" }),
    ).toHaveClass(/rounded-pill/u);
    await expect(
      confirmFirst.getByRole("button", { name: "Not now" }),
    ).toBeFocused();
    await confirmFirst.getByRole("button", { name: "Not now" }).click();
    await expect(confirmFirst).toBeHidden();
  } finally {
    await setEmailConfirmed(email, true);
  }

  await scene(page, "Change email: the link goes to the new address");
  await page.goto("/account/email");
  await expect(page.getByRole("heading", { name: "Email" })).toBeVisible({
    timeout: 15_000,
  });
  await hydrated(page);
  await page.getByLabel("New email").fill(`moved-${email}`);
  await page.getByLabel("Current password").fill(`${PASSPHRASE}-2`);
  await page.getByRole("button", { name: "Send link" }).click();
  await expect(page.getByText(/^Sent ✓/u)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("form").getByRole("status")).toHaveText(
    "Link sent.",
  );

  await scene(
    page,
    "Settings › Notifications: only the run reminder can email",
  );
  await page.goto("/account/notifications");
  await hydrated(page);
  await expect(page.getByText("Always sent")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Email" })).toBeChecked();

  // The link in every reminder's footer, opened from the inbox
  // (e2e/support/email-links): opening it asks, and changes nothing until
  // its one button is pressed (D-64 — scanners open every link).
  await scene(page, "The email's unsubscribe link: no log-in, one button");
  await page.goto(await unsubscribeLinkFor(email));
  await expect(
    page.getByRole("heading", { name: "Stop run reminder emails?" }),
  ).toBeVisible({ timeout: 15_000 });
  await hydrated(page);
  await page.getByRole("button", { name: "Unsubscribe" }).click();
  await expect(
    page.getByRole("heading", { name: "Run reminder emails are off" }),
  ).toBeVisible({ timeout: 15_000 });
  // A second visit shows the done state (round 27 #8); turning them back
  // on returns to the question.
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Run reminder emails are off" }),
  ).toBeVisible({ timeout: 15_000 });
  await hydrated(page);
  await page.getByRole("button", { name: "Turn them back on" }).click();
  await expect(
    page.getByRole("heading", { name: "Stop run reminder emails?" }),
  ).toBeVisible({ timeout: 15_000 });

  await scene(page, "Sign out everywhere");
  await page.goto("/account/sign-in");
  await hydrated(page);
  await page.getByRole("button", { name: "Sign out everywhere" }).click();
  await expect(page).toHaveURL(/\/$/u, { timeout: 15_000 });
  await page.goto("/call");
  await expect(page).toHaveURL(/\/auth\/login/u, { timeout: 15_000 });

  // Back in, with the password changed above.
  await logIn(page, email, `${PASSPHRASE}-2`);

  await scene(
    page,
    "Export your data: Get a copy, and it's Preparing (ACC-10)",
  );
  // Round 28 #15: a download link that is expired, or not this runner's,
  // lands on the row and says so — the same words for both.
  await page.goto("/account/export/not-a-real-link");
  await expect(page).toHaveURL(/\/account\/sign-in\?export=expired/u, {
    timeout: 15_000,
  });
  await expect(page.getByRole("heading", { name: "Account" })).toBeVisible({
    timeout: 15_000,
  });
  await hydrated(page);
  const exportRow = page.locator("[data-part='export-row']");
  await expect(exportRow).toContainText(
    "That link doesn't work any more. Get a copy for a new one.",
  );
  await exportRow.getByRole("button", { name: "Get a copy" }).click();
  // Preparing — or already past it. `dialed-exports` hands its consumer one
  // job at a time with no batch wait (decision D-86), so the local stack
  // can finish a new account's small ZIP before the row reloads.
  await expect(
    exportRow
      .getByText("We'll email a link when it's ready.")
      .or(exportRow.getByRole("link", { name: "Download" })),
  ).toBeVisible({ timeout: 15_000 });

  // The queued build runs in the local stack's own consumer; the email
  // goes to the local send_email binding. What the page shows once it has
  // run is the day's copy, offered here as well as by email.
  await scene(page, "The ZIP is built and emailed; today the row offers it");
  await expect(async () => {
    await page.reload();
    await expect(exportRow.getByRole("link", { name: "Download" })).toBeVisible(
      { timeout: 2000 },
    );
  }).toPass({ timeout: 60_000 });
  await expect(exportRow).toContainText("Emailed. The link works until");
  await hydrated(page);
  const download = page.waitForEvent("download");
  await exportRow.getByRole("link", { name: "Download" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(
    /^dialed-run-export-\d{4}-\d{2}-\d{2}\.zip$/u,
  );

  // Round 40 C1: the way back from a Google re-sign-in (the URL Google
  // returns to) reopens the sheet with no message and focus on Delete my
  // account. It sends nothing on its own; the press is the runner's.
  await scene(
    page,
    "Back from Google: the sheet reopens, quiet, on Delete my account",
  );
  await page.goto("/account/sign-in?deleting=1");
  await hydrated(page);
  const returned = page.getByRole("dialog", { name: "Delete your account?" });
  await expect(returned).toBeVisible({ timeout: 15_000 });
  await expect(
    returned.getByRole("button", { name: "Delete my account" }),
  ).toBeFocused();
  await expect(returned.getByRole("status")).toHaveText("");
  await returned.getByRole("button", { name: "Keep it" }).click();
  await expect(returned).toBeHidden();

  await scene(page, "Delete account: the password once more, then 7 days");
  await page.getByRole("button", { name: /^Delete account/u }).click();
  const sheet = page.getByRole("dialog", { name: "Delete your account?" });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel("Current password").fill(`${PASSPHRASE}-2`);
  await sheet.getByRole("button", { name: "Delete my account" }).click();
  await expect(
    page.getByRole("heading", { name: /^Your account goes on /u }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Deletion scheduled")).toBeVisible();
  // Signed out on every device.
  await page.goto("/call");
  await expect(page).toHaveURL(/\/auth\/login/u, { timeout: 15_000 });

  await scene(page, "Logging in inside the week asks: keep it?");
  await logIn(page, email, `${PASSPHRASE}-2`);
  await expect(
    page.getByRole("heading", { name: "Keep your account?" }),
  ).toBeVisible({ timeout: 15_000 });
  await hydrated(page);
  // Every page asks first; nothing is cancelled silently.
  await page.goto("/onboarding/settings");
  await expect(
    page.getByRole("heading", { name: "Keep your account?" }),
  ).toBeVisible({ timeout: 15_000 });
  await hydrated(page);
  // Keep brings everything back but Strava, and says so (round 28 #12).
  await expect(
    page.getByText(
      /Keep it and your runs, closet and entries come back as they were\.$/u,
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Strava is disconnected, and stays that way until you connect it again.",
    ),
  ).toBeVisible();
  // Round 40 C1: Keep pressed once the purge has begun is NOT KEPT in
  // Keep's place, with no Try again; Log out stays.
  await scene(page, "Keep after the purge has begun: NOT KEPT, Log out stays");
  await keepAnswersTooLate(page);
  await page.getByRole("button", { name: "Keep my account" }).click();
  const notKept = page.locator(
    "[data-part='failure-band'][data-state='refused']",
  );
  await expect(notKept).toContainText("Not kept", { timeout: 15_000 });
  await expect(notKept).toContainText(
    "Your account is already being deleted. It can't be kept now.",
  );
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Keep my account" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
  await expect(page.getByText("Deletion scheduled")).toBeVisible();
  // The rest of the journey is a purge that never started.
  await page.reload();
  await hydrated(page);

  await scene(page, "Inside the week, Keep brings it back");
  await page.getByRole("button", { name: "Keep my account" }).click();
  // Kept: back into the app (this runner lands on onboarding, which the
  // demo skipped), and never asked again.
  await expect(page).not.toHaveURL(/\/account\/leaving/u, {
    timeout: 15_000,
  });
  await page.goto("/onboarding/settings");
  await expect(page.getByRole("link", { name: /^Account/u })).toBeVisible({
    timeout: 15_000,
  });

  // ACC-12: a moderator renames the handle from the Desk (written here as
  // `forceRename` writes it), and the runner's next load is O0's re-pick.
  await scene(
    page,
    "Renamed by a moderator: the next load asks for a new name",
  );
  await withLocalDb(async ({ core }) => {
    const [account] = await core
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email));
    if (account === undefined) throw new Error("no account for the demo");
    const now = nowSeconds();
    await core.insert(usernameHistory).values({
      username: handle,
      userId: account.id,
      retiredAt: now,
      lockedAt: now,
    });
    await core
      .update(userProfiles)
      .set({
        username: `runner_${handle.slice(-4)}`,
        usernameResetReason: "Offensive or sexual",
      })
      .where(eq(userProfiles.userId, account.id));
  });
  await page.goto("/onboarding/settings");
  await expect(
    page.getByRole("heading", { name: "Pick a new username" }),
  ).toBeVisible({ timeout: 15_000 });
  await hydrated(page);
  await expect(page.getByText("Username changed by a moderator")).toBeVisible();
  await expect(
    page.getByText(
      `@${handle} broke the rules on names: offensive or sexual. For now you're @runner_${handle.slice(-4)}. Your runs and closet haven't changed.`,
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: `Keep @runner_${handle.slice(-4)} for now` })
    .click();
  await expect(page).not.toHaveURL(/\/onboarding\/handle/u, {
    timeout: 15_000,
  });
  // Shown once: the next load goes where it was going.
  await page.goto("/onboarding/settings");
  await expect(page.getByRole("link", { name: /^Account/u })).toBeVisible({
    timeout: 15_000,
  });
});

async function logIn(page: Page, email: string, password: string) {
  await page.goto("/auth/login");
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible({
    timeout: 15_000,
  });
  await hydrated(page);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).not.toHaveURL(/\/auth\/login/u, { timeout: 15_000 });
}
