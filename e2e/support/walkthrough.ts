import type { BrowserContext } from "@playwright/test";

import { userIdForEmail } from "../conformance/logging-fixtures";
import { test as demo } from "./demo";
import { ensureInviteCode } from "./invites";
import { signUpRunner } from "./runner";

/**
 * The runner a walkthrough stars: new for every test, so a story never
 * inherits another's rows, and the desk and phone recordings of one story
 * never share an account (design 180, step 5).
 */
export interface Runner {
  readonly email: string;
  readonly handle: string;
  readonly userId: string;
  /**
  Its signed-in session, which the test's page opens with.
  */
  readonly state: Awaited<ReturnType<BrowserContext["storageState"]>>;
}

/**
 * The base test for `e2e/walkthroughs/*.walkthrough.spec.ts`: the demo
 * fixture (narration, cursor, a11y off while recording), signed in as a
 * fresh runner. The sign-up runs in a context of its own before the
 * test's page exists, so the video opens signed in. A story about signing
 * up (first run) imports `./demo` instead and films it.
 */
export const test = demo.extend<{ runner: Runner }>({
  // A sign-up through the real forms, before the test body (and its own
  // setTimeout) runs: its own budget, so a loaded machine does not spend
  // the default 30 s on it.
  runner: [
    async ({ browser, baseURL }, use, testInfo) => {
      const stamp = String(Date.now()).slice(-7);
      const project = testInfo.project.name.replace("walkthrough", "w");
      const handle = `${project.replace("-", "_")}_${stamp}`;
      const email = `${handle}@example.com`;
      const context = await signUpRunner(browser, {
        baseURL,
        email,
        handle,
        inviteCode: await ensureInviteCode(),
        finishOnboarding: true,
      });
      const state = await context.storageState();
      await context.close();
      await use({ email, handle, userId: await userIdForEmail(email), state });
    },
    { timeout: 120_000 },
  ],
  storageState: async ({ runner }, use) => {
    await use(runner.state);
  },
});

export { expect } from "./demo";
