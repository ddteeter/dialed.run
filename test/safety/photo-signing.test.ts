import { describe, expect, it } from "vitest";

import { env } from "../../src/env";

import {
  hmacKey,
  isSignatureValid,
  maxSignedLifeSeconds,
  signedExpiry,
  signPhotoKey,
} from "../../src/modules/safety/photo-signing";

/**
 * SAF-7's signatures. The route that uses them is tested through
 * `photoResponse` in `test/feed/photos.test.ts`; this pins the rules the
 * route leans on — the bucketing, the bound, and what a forger cannot do.
 */

const SECRET = "test-signing-secret";

/**
Runs `act` with the deployment's secret unset, then puts it back.
*/
async function withoutSecret<T>(act: () => Promise<T>): Promise<T> {
  const configured: unknown = env.PHOTO_URL_SECRET;
  Reflect.deleteProperty(env, "PHOTO_URL_SECRET");
  try {
    return await act();
  } finally {
    Reflect.set(env, "PHOTO_URL_SECRET", configured);
  }
}
const KEY = "entries/u1/e1/p1";
const NOW = 1_800_000_000; // a quarter-hour boundary

async function signed(key = KEY, expires = signedExpiry(NOW)) {
  const signature = await signPhotoKey(key, expires, SECRET);
  if (signature === undefined) throw new Error("expected a signature");
  return signature;
}

describe("signedExpiry", () => {
  it("rounds up to a quarter-hour boundary plus one quarter-hour", () => {
    expect(signedExpiry(NOW)).toBe(NOW + 1800);
    expect(signedExpiry(NOW + 1)).toBe(NOW + 1800);
    expect(signedExpiry(NOW + 899)).toBe(NOW + 1800);
    expect(signedExpiry(NOW + 900)).toBe(NOW + 2700);
  });

  it("never lives longer than the bound, nor shorter than a quarter-hour", () => {
    for (const offset of [0, 1, 450, 899]) {
      const life = signedExpiry(NOW + offset) - (NOW + offset);
      expect(life).toBeLessThanOrEqual(maxSignedLifeSeconds);
      expect(life).toBeGreaterThan(900);
    }
    expect(maxSignedLifeSeconds).toBe(1800);
  });
});

describe("signing", () => {
  it("gives the same URL to everyone in the same bucket", async () => {
    const first = await signed(KEY, signedExpiry(NOW + 10));
    const second = await signed(KEY, signedExpiry(NOW + 800));
    expect(first).toStrictEqual(second);
    expect(first.signature).toMatch(/^[\w-]+$/u);
  });

  it("signs nothing without a secret", async () => {
    expect(
      await withoutSecret(() => signPhotoKey(KEY, NOW + 900)),
    ).toBeUndefined();
    expect(await signPhotoKey(KEY, NOW + 900, "")).toBeUndefined();
  });

  it("signs with the deployment's secret by default", async () => {
    const byDefault = await signPhotoKey(KEY, NOW + 900);
    const explicit = await signPhotoKey(KEY, NOW + 900, env.PHOTO_URL_SECRET);
    expect(byDefault).toStrictEqual(explicit);
    expect(byDefault).not.toStrictEqual(
      await signPhotoKey(KEY, NOW + 900, SECRET),
    );
  });
});

async function isValid(
  claimed: { expires?: string | undefined; signature?: string | undefined },
  now = NOW,
  key = KEY,
  secret: string | undefined = SECRET,
) {
  return isSignatureValid(key, claimed, now, secret);
}

describe("hmacKey", () => {
  it("can sign and verify, and cannot be read back out", async () => {
    const key = await hmacKey(SECRET);
    expect(key.extractable).toBe(false);
    expect(key.usages.toSorted((a, b) => a.localeCompare(b))).toStrictEqual([
      "sign",
      "verify",
    ]);
  });
});

describe("isSignatureValid", () => {
  it("accepts its own signature while it lives", async () => {
    const { expires, signature } = await signed();
    expect(await isValid({ expires: String(expires), signature })).toBe(true);
    expect(
      await isValid({ expires: String(expires), signature }, expires - 1),
    ).toBe(true);
  });

  it("refuses it once expired", async () => {
    const { expires, signature } = await signed();
    expect(
      await isValid({ expires: String(expires), signature }, expires),
    ).toBe(false);
  });

  it("refuses a signature for another key, or another expiry", async () => {
    const { expires, signature } = await signed();
    expect(
      await isValid(
        { expires: String(expires), signature },
        NOW,
        "entries/u1/e1/p2",
      ),
    ).toBe(false);
    expect(
      await isValid({ expires: String(expires - 900), signature }, NOW),
    ).toBe(false);
  });

  it("refuses a tampered signature and a different secret", async () => {
    const { expires, signature } = await signed();
    const flipped = `${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;
    expect(
      await isValid({ expires: String(expires), signature: flipped }),
    ).toBe(false);
    expect(
      await isValid({ expires: String(expires), signature }, NOW, KEY, "other"),
    ).toBe(false);
    const mine = await signPhotoKey(KEY, expires);
    expect(
      await withoutSecret(() =>
        isSignatureValid(
          KEY,
          { expires: String(expires), signature: mine?.signature ?? "" },
          NOW,
        ),
      ),
    ).toBe(false);
    expect(
      await isSignatureValid(
        KEY,
        { expires: String(expires), signature: mine?.signature ?? "" },
        NOW,
      ),
    ).toBe(true);
    expect(
      await isValid({ expires: String(expires), signature }, NOW, KEY, ""),
    ).toBe(false);
  });

  it("refuses an expiry that fails the safe-integer guard, even forged for it", async () => {
    // A guard that were ever bypassed would fall through to a comparison
    // against `now` and then to `verify` — both of which are NaN-tolerant
    // and would otherwise quietly agree with a signature minted for the
    // same NaN expiry.
    const forged = await signPhotoKey(KEY, NaN, SECRET);
    if (forged === undefined) throw new Error("expected a signature");
    expect(
      await isValid({ expires: "banana", signature: forged.signature }),
    ).toBe(false);
  });

  it("refuses a signature valid only in the middle, not from the start", async () => {
    // The base64url check is anchored at both ends. A regex missing the
    // leading `^` would still match the tail of this string and hand it to
    // `atob`, which is not a base64 alphabet in the middle either — the
    // point is that the leading `!` must be rejected outright, not that it
    // happens to also fail to decode.
    const expires = String(signedExpiry(NOW));
    const isAccepted = await isValid({
      expires,
      signature: "!abcabcabcabcabcabc",
    });
    expect(isAccepted).toBe(false);
  });

  it("refuses a life longer than any URL it hands out, even when signed", async () => {
    const far = NOW + maxSignedLifeSeconds + 1;
    const { signature } = await signed(KEY, far);
    expect(await isValid({ expires: String(far), signature })).toBe(false);
    const edge = NOW + maxSignedLifeSeconds;
    const atEdge = await signed(KEY, edge);
    expect(
      await isValid({ expires: String(edge), signature: atEdge.signature }),
    ).toBe(true);
  });

  it("refuses what is missing or malformed", async () => {
    const { expires, signature } = await signed();
    expect(await isValid({ expires: undefined, signature })).toBe(false);
    expect(await isValid({ expires: "soon", signature })).toBe(false);
    expect(await isValid({ expires: "1.5", signature })).toBe(false);
    expect(
      await isValid({ expires: String(expires), signature: undefined }),
    ).toBe(false);
    expect(
      await isValid({ expires: String(expires), signature: "not base64!" }),
    ).toBe(false);
  });
});
