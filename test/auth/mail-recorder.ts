import type { AuthMail } from "../../src/modules/account";

/**
 * `createAuth`'s `mail`, replaced by a recorder: which email auth asked
 * for, and for whom. What each one then sends is `account/verification`'s,
 * tested there.
 */
export function recordingMail(): AuthMail & {
  calls: { kind: string; email: string; token?: string }[];
} {
  const calls: { kind: string; email: string; token?: string }[] = [];
  return {
    calls,
    newAccount: (account) => {
      calls.push({ kind: "newAccount", email: account.email });
      return Promise.resolve();
    },
    existingAccount: (account) => {
      calls.push({ kind: "existingAccount", email: account.email });
      return Promise.resolve();
    },
    resetPassword: (account, token) => {
      calls.push({ kind: "resetPassword", email: account.email, token });
      return Promise.resolve();
    },
  };
}
