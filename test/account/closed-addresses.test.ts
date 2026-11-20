import { drizzle } from "drizzle-orm/d1";
import { beforeEach, describe, expect, it } from "vitest";

import { closedAddresses } from "../../src/db/schema-core";
import { env } from "../../src/env";
import {
  CLOSED_ADDRESS_KEPT_S,
  closedAddressHash,
  closedAddressRows,
  forgetClosedAddresses,
  isClosedAddress,
} from "../../src/modules/account/access/closed-addresses";

/**
 * SA-L09: what is kept of a closed account's addresses, and what sign-up
 * reads of it. Every key here is a test value, not a deployed one.
 */

const core = drizzle(env.DIALED_CORE);
const KEY = "closed-address-test-key";
const NOW = 1_757_000_000;

beforeEach(async () => {
  await core.delete(closedAddresses);
});

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

describe("closedAddressHash", () => {
  it("is a SHA-256 HMAC in lowercase hex, the same each time", async () => {
    const hash = await closedAddressHash(KEY, "ada@example.test");

    expect(hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(await closedAddressHash(KEY, "ada@example.test")).toBe(hash);
  });

  it("is one fingerprint for an address however it is cased or padded", async () => {
    expect(await closedAddressHash(KEY, "  Ada@Example.TEST ")).toBe(
      await closedAddressHash(KEY, "ada@example.test"),
    );
  });

  it("differs by address and by key", async () => {
    const hash = await closedAddressHash(KEY, "ada@example.test");

    expect(await closedAddressHash(KEY, "bea@example.test")).not.toBe(hash);
    expect(await closedAddressHash(`${KEY}-2`, "ada@example.test")).not.toBe(
      hash,
    );
  });

  it("is keyed under its own purpose, not a bare HMAC of the address", async () => {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(KEY),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const bare = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode("ada@example.test"),
    );
    const purposed = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode("dialed.run closed address v1|ada@example.test"),
    );
    const hash = await closedAddressHash(KEY, "ada@example.test");

    expect(hash).toBe(hex(purposed));
    expect(hash).not.toBe(hex(bare));
  });
});

describe("closedAddressRows", () => {
  it.each([undefined, ""])("keeps nothing without a key (%j)", async (key) => {
    expect(
      await closedAddressRows(key, ["ada@example.test"], NOW),
    ).toStrictEqual([]);
  });

  it("keeps one row per distinct address, stamped with when it closed", async () => {
    const rows = await closedAddressRows(
      KEY,
      ["ada@example.test", "ADA@example.test", "bea@example.test"],
      NOW,
    );

    expect(rows).toStrictEqual([
      { hash: await closedAddressHash(KEY, "ada@example.test"), closedAt: NOW },
      { hash: await closedAddressHash(KEY, "bea@example.test"), closedAt: NOW },
    ]);
  });
});

describe("isClosedAddress", () => {
  beforeEach(async () => {
    await core
      .insert(closedAddresses)
      .values(await closedAddressRows(KEY, ["ada@example.test"], NOW));
  });

  it("matches a kept address, however it is typed", async () => {
    expect(await isClosedAddress(core, KEY, " Ada@Example.test")).toBe(true);
  });

  it("does not match another address", async () => {
    expect(await isClosedAddress(core, KEY, "bea@example.test")).toBe(false);
  });

  it("does not match under another key", async () => {
    expect(await isClosedAddress(core, `${KEY}-2`, "ada@example.test")).toBe(
      false,
    );
  });

  it.each([undefined, ""])("refuses nobody without a key (%j)", async (key) => {
    expect(await isClosedAddress(core, key, "ada@example.test")).toBe(false);
  });
});

describe("forgetClosedAddresses", () => {
  it("keeps an address for 3 years to the second, then lets it go", async () => {
    expect(CLOSED_ADDRESS_KEPT_S).toBe(94_608_000);
    const [atEdge, past] = await closedAddressRows(
      KEY,
      ["edge@example.test", "past@example.test"],
      0,
    );
    await core.insert(closedAddresses).values([
      { hash: atEdge?.hash ?? "", closedAt: NOW - CLOSED_ADDRESS_KEPT_S },
      { hash: past?.hash ?? "", closedAt: NOW - CLOSED_ADDRESS_KEPT_S - 1 },
    ]);

    await forgetClosedAddresses(core, NOW);

    expect(
      await core.select({ hash: closedAddresses.hash }).from(closedAddresses),
    ).toStrictEqual([{ hash: atEdge?.hash }]);
  });
});
