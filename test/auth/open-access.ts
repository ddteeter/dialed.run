import type { AccessGate } from "../../src/modules/auth/access-hook";

/**
 * `createAuth`'s `access` for a test that is not about the way in: open
 * sign-up (invite-only off) and a Turnstile that always passes. The gate
 * itself is `test/auth/access-hook.test.ts`'s subject.
 */
export const OPEN_ACCESS: AccessGate = {
  isInviteOnly: false,
  passesTurnstile: () => Promise.resolve(true),
  standing: () => Promise.resolve("open"),
  claim: () => Promise.resolve("redeemed"),
  confirm: () => Promise.resolve(),
};
