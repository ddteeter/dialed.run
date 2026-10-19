import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  ACCESS_CODES,
  ACCESS_HEADERS,
  BLOCKED_US_REGIONS,
  INVITE_ALPHABET,
  INVITE_COPY,
  INVITE_PREFIX,
  REGION_BLOCKED_CODE,
  REGION_BLOCKED_COPY,
  REGION_COPY,
  TURNSTILE_REFUSED,
  blockedRegionOf,
  inviteCodeField,
  isBlockedRegion,
  isFromBlockedRegion,
  mintInviteCode,
  normalizeInviteCode,
  regionInviteRefusal,
  regionTag,
} from "../../src/lib/contracts/access";

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
      inviteCodeField
        .safeParse(typed)
        .error?.issues.map((issue) => issue.message);
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
  it("are round 28 #9's and round 27 #12's, as drawn", () => {
    expect(INVITE_COPY).toStrictEqual({
      missing: "Enter the code from your invite.",
      invalid: "That code doesn't work. Check it, or request access.",
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
    });
  });
});

/**
 * The blocked states (owner, 2026-10-18): Cloudflare's placing of the
 * request, parsed as untrusted, and anything unplaced let through.
 */
describe("isFromBlockedRegion", () => {
  function placed(cf: unknown): Request {
    return new Request("https://app.dialed.run/", {
      cf: z.record(z.string(), z.unknown()).parse(cf),
    });
  }

  it.each(["MS", "TN"])("blocks a request from %s", (regionCode) => {
    const request = placed({ country: "US", regionCode });
    expect(isFromBlockedRegion(request)).toBe(true);
    expect(blockedRegionOf(request)).toBe(regionCode);
  });

  it.each([
    ["another state", { country: "US", regionCode: "CA" }],
    ["the same code in another country", { country: "CA", regionCode: "TN" }],
    ["a region with no country", { regionCode: "MS" }],
    ["a country with no region", { country: "US" }],
    ["a region that is not a string", { country: "US", regionCode: 12 }],
    [
      "an inherited key, not a listed one",
      { country: "US", regionCode: "toString" },
    ],
  ])("lets through %s", (_, cf) => {
    expect(isFromBlockedRegion(placed(cf))).toBe(false);
    expect(blockedRegionOf(placed(cf))).toBeUndefined();
  });

  it("lets through a request Cloudflare did not place, and no request at all", () => {
    expect(isFromBlockedRegion(new Request("https://app.dialed.run/"))).toBe(
      false,
    );
    expect(isFromBlockedRegion(undefined)).toBe(false);
    expect(isFromBlockedRegion({ cf: "MS" })).toBe(false);
  });

  it("reads the same slice off a plain object as off a request", () => {
    expect(
      isFromBlockedRegion({ cf: { country: "US", regionCode: "TN" } }),
    ).toBe(true);
  });

  it("names every blocked state in the copy, from the list", () => {
    expect(Object.keys(BLOCKED_US_REGIONS)).toStrictEqual(["MS", "TN"]);
    expect(REGION_COPY).toStrictEqual({
      signUp:
        "dialed.run isn't open to new sign-ups from Mississippi or Tennessee. State laws there require ID age checks for every new account, which we don't do.",
      waitlist:
        "Thanks. Sign-up isn't open in Mississippi or Tennessee yet, because state laws there require ID age checks for every new account. We'll email you if that changes.",
    });
    expect(REGION_BLOCKED_COPY).toBe(REGION_COPY.signUp);
    expect(REGION_BLOCKED_CODE).toBe("REGION_BLOCKED");
  });

  it("tells D7 which state, and why there is no invite", () => {
    expect(regionTag("TN")).toBe("[TN]");
    expect(regionInviteRefusal("TN")).toBe(
      "No invite while sign-up is closed in Tennessee.",
    );
    expect(isBlockedRegion("MS")).toBe(true);
    expect(isBlockedRegion("")).toBe(false);
    expect(isBlockedRegion("toString")).toBe(false);
  });
});
