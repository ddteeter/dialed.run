import { describe, expect, it } from "vitest";

import { placeStamps } from "../../src/modules/onboarding/place-stamp";

/**
 * Find's stamp on a found place: only the place the provider named, under
 * the Worker's secret, is taken back by the place writers.
 */
const MADISON = {
  address: "Madison, WI, United States",
  lat: 43.07,
  lng: -89.38,
};

const stamps = placeStamps("test-secret");

describe("placeStamps", () => {
  it("stamps a place with 64 lowercase hex characters", async () => {
    expect(await stamps.stamp(MADISON)).toMatch(/^[\da-f]{64}$/u);
  });

  it("signs the place's address and coordinates under its purpose label", async () => {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode("test-secret"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signed = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(
        'dialed.run place stamp v1|["Madison, WI, United States",43.07,-89.38]',
      ),
    );
    const hex = Array.from(new Uint8Array(signed), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");

    expect(await stamps.stamp(MADISON)).toBe(hex);
  });

  it("takes a stamp back for its own place", async () => {
    const stamp = await stamps.stamp(MADISON);

    expect(await stamps.verifyStamp(MADISON, stamp)).toBe(true);
  });

  it("gives two places two stamps", async () => {
    expect(await stamps.stamp(MADISON)).not.toBe(
      await stamps.stamp({ ...MADISON, address: "Madison, AL, United States" }),
    );
  });

  it.each([
    ["address", { address: "Portland, OR, United States" }],
    ["latitude", { lat: 43.08 }],
    ["longitude", { lng: -89.39 }],
  ])("refuses a stamp for a changed %s", async (_part, change) => {
    const stamp = await stamps.stamp(MADISON);

    expect(await stamps.verifyStamp({ ...MADISON, ...change }, stamp)).toBe(
      false,
    );
  });

  it("refuses a stamp given under another secret", async () => {
    const stamp = await placeStamps("another-secret").stamp(MADISON);

    expect(await stamps.verifyStamp(MADISON, stamp)).toBe(false);
  });

  it("refuses a stamp that is not 64 lowercase hex characters", async () => {
    const stamp = await stamps.stamp(MADISON);

    for (const bad of [
      stamp.toUpperCase(),
      stamp.slice(0, 63),
      `${stamp}0`,
      `${stamp.slice(0, 63)}g`,
      `x${stamp}`,
      "",
    ]) {
      expect(await stamps.verifyStamp(MADISON, bad)).toBe(false);
    }
  });

  it.each([
    ["empty", ""],
    ["missing", undefined],
  ])(
    "stamps nothing and takes nothing with an %s secret",
    async (_case, secret) => {
      const unkeyed = placeStamps(secret);
      const stamp = await stamps.stamp(MADISON);

      expect(await unkeyed.stamp(MADISON)).toBe("");
      expect(await unkeyed.verifyStamp(MADISON, stamp)).toBe(false);
      expect(await unkeyed.verifyStamp(MADISON, "")).toBe(false);
    },
  );
});
