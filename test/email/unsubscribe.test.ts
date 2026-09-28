import { describe, expect, it } from "vitest";

import {
  signingKey,
  unsubscribeSignature,
  verifiedUnsubscribe,
} from "../../src/modules/email/unsubscribe";
import { SECRET } from "./helpers";

/**
 * The unsubscribe link's signature (round 26 #19): derived from the auth
 * secret with a purpose label, never extractable, and read back only for a
 * link whose search is entirely URL-safe characters.
 */

describe("signingKey", () => {
  it("keys by the secret, and the key cannot be exported", async () => {
    const key = await signingKey(SECRET);
    expect(key.extractable).toBe(false);
    expect(key.usages).toContain("sign");
    expect(key.usages).toContain("verify");
  });
});

describe("unsubscribeSignature", () => {
  it("matches an independent HMAC over the purpose-led message, pinning the purpose label", async () => {
    // Computed here without importing anything from the production module,
    // so a change to the purpose label, the derivation or the encoding
    // shows up as a mismatch rather than being masked by both sides sharing
    // one (possibly mutated) implementation.
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const raw = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode("dialed.run unsubscribe v1|u1|run_reminder"),
    );
    const expected = btoa(String.fromCodePoint(...new Uint8Array(raw)))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");

    expect(await unsubscribeSignature(SECRET, "u1", "run_reminder")).toBe(
      expected,
    );
  });
});

describe("verifiedUnsubscribe", () => {
  it("names the runner and kind for a link it signed", async () => {
    const s = await unsubscribeSignature(SECRET, "u1", "run_reminder");
    expect(
      await verifiedUnsubscribe(SECRET, { u: "u1", k: "run_reminder", s }),
    ).toStrictEqual({ userId: "u1", kind: "run_reminder" });
  });

  it("answers undefined, never a thrown error, for a signature with a character atob cannot decode anywhere but its tail", async () => {
    // The check must anchor at *both* ends: an unanchored `$`-only test
    // still matches this string, because it merely ends in url-safe
    // characters, and the malformed prefix would otherwise reach `atob`
    // uncaught.
    await expect(
      verifiedUnsubscribe(SECRET, {
        u: "u1",
        k: "run_reminder",
        s: "abc!def",
      }),
    ).resolves.toBeUndefined();
  });

  it("answers undefined, never a thrown error, for a signature one character past a multiple of four", async () => {
    // Every character is in the alphabet, but no byte count encodes to a
    // length of 4n + 1, so `atob` throws on it. 1 and 5 are the two
    // lengths a truncated link lands on first.
    for (const s of ["a", "abcde"]) {
      await expect(
        verifiedUnsubscribe(SECRET, { u: "u1", k: "run_reminder", s }),
      ).resolves.toBeUndefined();
    }
  });

  it("still reads a signature two or three past a multiple of four", async () => {
    // The HMAC's 32 bytes are 43 characters (4n + 3): only 4n + 1 is
    // refused, not every length that is not a multiple of four.
    const s = await unsubscribeSignature(SECRET, "u1", "run_reminder");
    expect(s.length % 4).toBe(3);
    expect(
      await verifiedUnsubscribe(SECRET, {
        u: "u1",
        k: "run_reminder",
        s: s.slice(0, 42),
      }),
    ).toBeUndefined();
  });

  it("answers undefined for a signature made with a different secret", async () => {
    const s = await unsubscribeSignature("other-secret", "u1", "run_reminder");
    expect(
      await verifiedUnsubscribe(SECRET, { u: "u1", k: "run_reminder", s }),
    ).toBeUndefined();
  });
});
