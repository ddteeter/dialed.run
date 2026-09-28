import { describe, expect, it } from "vitest";

import {
  ACCESS_CODES,
  ACCESS_HEADERS,
  INVITE_ALPHABET,
  INVITE_COPY,
  INVITE_PREFIX,
  TURNSTILE_REFUSED,
  inviteCodeField,
  mintInviteCode,
  normalizeInviteCode,
} from "../../src/lib/access";

/**
 * The invite code's shape and words (task 126, ACC-5; round 26 #20,
 * round 27 #12).
 */
describe("the invite code", () => {
  it("is DIAL- and four of an alphabet with no 0/O or 1/I", () => {
    expect(INVITE_PREFIX).toBe("DIAL-");
    expect(INVITE_ALPHABET).toHaveLength(32);
    for (const confusable of ["0", "O", "1", "I"]) {
      expect(INVITE_ALPHABET).not.toContain(confusable);
    }
    expect(new Set(INVITE_ALPHABET).size).toBe(32);
  });

  it("ignores case and spaces, and puts back a DIAL- left off", () => {
    expect(normalizeInviteCode(" dial-7k3p ")).toBe("DIAL-7K3P");
    expect(normalizeInviteCode("7k 3p")).toBe("DIAL-7K3P");
    expect(normalizeInviteCode("DIAL-7K3P")).toBe("DIAL-7K3P");
  });

  it("parses to the stored form, refusing the wrong shape as invalid", () => {
    expect(inviteCodeField.parse("dial-7k3p")).toBe("DIAL-7K3P");
    const message = (typed: string) =>
      inviteCodeField.safeParse(typed).error?.issues.map((issue) => issue.message);
    expect(message("")).toStrictEqual([INVITE_COPY.missing]);
    expect(message("DIAL-7K3")).toStrictEqual([INVITE_COPY.invalid]);
    expect(message("DIAL-7K3PP")).toStrictEqual([INVITE_COPY.invalid]);
    expect(message("DIAL-0K3P")).toStrictEqual([INVITE_COPY.invalid]);
    expect(message("XDIAL-7K3P")).toStrictEqual([INVITE_COPY.invalid]);
    expect(message("DIAL-7K3P!")).toStrictEqual([INVITE_COPY.invalid]);
  });

  it("mints from the alphabet, one character per random byte", () => {
    expect(mintInviteCode(() => new Uint8Array([0, 1, 31, 32]))).toBe(
      "DIAL-23Z2",
    );
    expect(mintInviteCode(() => new Uint8Array([255, 7, 8, 30]))).toBe(
      "DIAL-Z9AY",
    );
    let asked = 0;
    mintInviteCode((length) => {
      asked = length;
      return new Uint8Array(length);
    });
    expect(asked).toBe(4);
    expect(mintInviteCode()).toMatch(/^DIAL-[2-9A-HJ-NP-Z]{4}$/u);
  });
});

describe("the words", () => {
  it("are round 26 #20's and round 27 #12's, as drawn", () => {
    expect(INVITE_COPY).toStrictEqual({
      missing: "Enter your invite code.",
      invalid:
        "That code doesn't work. Check it against the email or message it came in.",
      used: "That code has already been used. Ask whoever sent it for another.",
    });
    expect(TURNSTILE_REFUSED).toBe(
      "We couldn't check this browser. Reload the page and try again.",
    );
  });

  it("names the headers and codes the two sides share", () => {
    expect(ACCESS_HEADERS).toStrictEqual({
      inviteCode: "x-invite-code",
      turnstileToken: "x-turnstile-token",
    });
    expect(ACCESS_CODES).toStrictEqual({
      turnstile: "TURNSTILE_REFUSED",
      missing: "INVITE_MISSING",
      invalid: "INVITE_INVALID",
      used: "INVITE_USED",
    });
  });
});
