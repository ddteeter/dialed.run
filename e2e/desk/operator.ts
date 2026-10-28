import type { Page } from "@playwright/test";

import { signInAsKnownUser } from "../support/known-user";

/**
 * The Desk's operator for e2e: the one user id `ADMIN_USER_IDS` names in
 * the dev server's `.dev.vars` (`e2e-desk-operator`; register R-72).
 *
 * **Admin-ness is configuration, not data** — `isAdmin` reads the env var
 * and nothing else — so the operator is a known user (`signInAsKnownUser`).
 */
export const OPERATOR_ID = "e2e-desk-operator";

/**
 * The operator's handle, claimed on arrival: the Desk is not O0's subject.
 */
const OPERATOR_HANDLE = "desk_operator";

export async function signInAsOperator(page: Page): Promise<void> {
  await signInAsKnownUser(page, OPERATOR_ID, OPERATOR_HANDLE);
}
