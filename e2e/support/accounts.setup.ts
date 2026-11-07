import { mkdirSync, writeFileSync } from "node:fs";

import { test as setup } from "@playwright/test";

import { DEMO_ACCOUNTS, storageStateFor } from "./accounts";
import { ensureInviteCode } from "./invites";
import { signUpRunner } from "./runner";

/**
 * Creates every demo's account and saves its session, before any demo runs.
 *
 * **It drives the real signup UI rather than seeding auth rows.** Minting a
 * session directly would mean reproducing Better Auth's password hashing
 * and its signed-cookie format in a test helper — coupling this harness to
 * an internal that can change under it without a word. Signing up through
 * the form knows nothing, and costs a few seconds in a project that
 * records no video.
 *
 * **One test, not one per account**, so the accounts file is written once
 * with no read-modify-write race. It writes under `node_modules`, because
 * Vite watches the source tree and a mid-run write there hot-reloads the
 * app out from under a running demo — see `./accounts.ts`. Each account gets its own browser
 * context, so no session leaks from one to the next.
 *
 * **Sign-up signs nobody in, and ends on Au4** (round 26 #11), so each
 * account opens its confirm link — the feed and verdict demos need runners
 * whose entries can be public (decision D-50) — and then logs in.
 */
const AUTH_DIR = "node_modules/.cache/dialed-demo-auth";

/**
 * The accounts this run needs. `scratch` serves only a recording (its
 * specs run only then, design 180), so a bare run, CI's included, signs
 * up exactly what it did before: the database the later specs and their
 * transcripts see is unchanged.
 */
const isRecording = Number(process.env.DEMO_SLOWMO ?? 0) !== 0;
const accountsThisRun = DEMO_ACCOUNTS.filter(
  (account) => isRecording || account !== "scratch",
);

/**
 * A handle for this run's account: the demo's name, underscored, and the
 * run's last digits so a second run on the same local database is free —
 * old handles are never reclaimable (round 26 #7).
 */
function demoHandle(account: string, suffix: string): string {
  return `${account.replace("-", "_")}_${suffix.slice(-6)}`;
}

setup("create the demo accounts", async ({ browser, baseURL }, testInfo) => {
  // Five signups through a real browser, serially. Nothing here is paced —
  // the setup project is not the demo project — but it is still five round
  // trips through Better Auth.
  testInfo.setTimeout(120_000);
  mkdirSync(AUTH_DIR, { recursive: true });
  const suffix = String(Date.now());
  const accounts: Record<string, string> = {};
  // Sign-up is invite-only (task 126, ACC-5): the harness's own code.
  const inviteCode = await ensureInviteCode();

  for (const account of accountsThisRun) {
    const email = `${account}-${suffix}@example.com`;
    // Every demo but `onboarding` starts past onboarding; that one films it.
    const context = await signUpRunner(browser, {
      baseURL,
      email,
      handle: demoHandle(account, suffix),
      inviteCode,
      finishOnboarding: account !== "onboarding",
    });

    await context.storageState({ path: storageStateFor(account) });
    await context.close();
    accounts[account] = email;
  }

  writeFileSync(
    `${AUTH_DIR}/accounts.json`,
    `${JSON.stringify(accounts, undefined, 2)}\n`,
  );
});
