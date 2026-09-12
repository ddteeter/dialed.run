import { readFileSync } from "node:fs";

import { z } from "zod";

/**
 * The demo accounts, created once per run before any demo is recorded.
 *
 * **Why these exist: the signup form is not what a reviewer came to
 * watch.** Every demo needs a session, only `auth` is *about* getting one,
 * and at the demo project's 1800ms pacing the six-action signup block is
 * ~11 seconds at the head of every video. Playwright's `storageState`
 * moves it into a setup project, which records nothing.
 *
 * **One account each, never a shared one.** `closet` asserts "Nothing in
 * here yet", `verdict` seeds rows owned by its own user, and `feed` builds
 * a follower graph — a single shared login would leak state between
 * journeys, and the suite is serial (`workers: 1`) so the leak would be
 * silent and ordered rather than flaky and obvious.
 */
export const DEMO_ACCOUNTS = [
  "closet",
  "feed",
  "run-logging",
  "verdict",
  "onboarding",
] as const;
export type DemoAccount = (typeof DEMO_ACCOUNTS)[number];

/**
 * Gitignored: these hold live session cookies for a local dev database.
 */
const AUTH_DIR = "e2e/.auth";

export function storageStateFor(account: DemoAccount): string {
  return `${AUTH_DIR}/${account}.json`;
}

const ACCOUNTS_FILE = `${AUTH_DIR}/accounts.json`;

const accountsSchema = z.record(z.string(), z.string());

/**
 * The address the setup signed this demo up with.
 *
 * **Per-run unique, not a fixed address, and that is a cleanup decision.**
 * A fixed one would have to be deleted before each run, and while `session`
 * and `account` cascade from `user`, nothing in `schema-core` references it
 * — so "delete the user" would leave `user_profiles`, `wardrobe_items`,
 * `runs` and the rest behind, and the tables to name would grow with the
 * schema. A fresh address is free and cannot leave a demo looking at the
 * last run's closet.
 *
 * Read at call time rather than at module load: the file is written by the
 * setup project, which runs after these modules are imported.
 */
export function accountEmail(account: DemoAccount): string {
  const raw: unknown = JSON.parse(readFileSync(ACCOUNTS_FILE, "utf8"));
  // Parsed rather than cast: this file is written by another process and is
  // `unknown` until something checks it, which is the same rule the app
  // follows at every other trust boundary.
  const found = accountsSchema.safeParse(raw).data?.[account];
  if (typeof found !== "string") {
    throw new TypeError(
      `No demo account for "${account}" in ${ACCOUNTS_FILE}. Run the demo-setup project first.`,
    );
  }
  return found;
}
