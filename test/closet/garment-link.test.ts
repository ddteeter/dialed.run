import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/d1";

import { env } from "../../src/env";
import { garmentSchema } from "../../src/lib/contracts";
import { allowedLinksOf } from "../../src/modules/closet";
import { linkDetailOf } from "../../src/modules/closet/garment-link";
import { createItem } from "../../src/modules/closet/service";
import { abandonedBefore } from "../../src/modules/enrichment";
import { newUlid } from "../../src/lib/ids";
import { denyDomain } from "../../src/modules/safety";

import { addAccount } from "../feed/helpers";
import { makeUser, resetSafetyTables } from "../safety/helpers";

function core() {
  return drizzle(env.DIALED_CORE);
}

describe("allowedLinksOf, the one read of a garment's link", () => {
  beforeEach(resetSafetyTables);

  it("shows a link the denylist allows, as it was stored", async () => {
    const links = await allowedLinksOf(core(), [
      { id: "a", productUrl: "https://janji.com/p/tee?c=grey" },
    ]);
    expect(links).toEqual(new Map([["a", "https://janji.com/p/tee?c=grey"]]));
  });

  it("drops a link whose domain was denied after it was saved", async () => {
    // The case a check at save cannot cover: the row is already there.
    const userId = await makeUser();
    const item = await createItem(
      core(),
      userId,
      garmentSchema.parse({
        category: "top",
        name: "Long sleeve",
        productUrl: "https://shop.spam.example/x",
      }),
    );
    await denyDomain("spam.example", userId);

    const links = await allowedLinksOf(core(), [item]);
    expect(links).toEqual(new Map());
  });

  it("drops a link that does not parse, an http one, and no link at all", async () => {
    const links = await allowedLinksOf(core(), [
      { id: "garbled", productUrl: "not a url" },
      { id: "plain", productUrl: ["http:", "//janji.com/p"].join("") },
      { id: "none", productUrl: "" },
    ]);
    expect(links).toEqual(new Map());
  });

  it("answers each garment of a mixed batch on its own", async () => {
    await denyDomain("spam.example", await makeUser());
    const links = await allowedLinksOf(core(), [
      { id: "denied", productUrl: "https://spam.example/x" },
      { id: "kept", productUrl: "https://janji.com/p" },
      { id: "also-kept", productUrl: "https://www.rabbit.run/p" },
    ]);
    expect(links).toEqual(
      new Map([
        ["kept", "https://janji.com/p"],
        ["also-kept", "https://www.rabbit.run/p"],
      ]),
    );
  });
});

async function runner(isConfirmed: boolean): Promise<string> {
  const userId = newUlid();
  await addAccount(userId, isConfirmed);
  return userId;
}

function garment(
  userId: string,
  overrides: Partial<Parameters<typeof linkDetailOf>[1]> = {},
): Parameters<typeof linkDetailOf>[1] {
  return {
    id: "g",
    userId,
    category: "top",
    name: "Rover Half-Zip",
    brand: "Janji",
    productUrl: "https://janji.com/p/rover",
    ...overrides,
  };
}

/**
 * The brand and link of a stored garment that has neither: what D1 hands
 * back as an empty column, read from a real row rather than typed.
 */
async function unsetColumns(): Promise<
  Pick<Parameters<typeof linkDetailOf>[1], "brand" | "productUrl">
> {
  const row = await createItem(
    core(),
    await makeUser(),
    garmentSchema.parse({ category: "top", name: "Long sleeve" }),
  );
  return { brand: row.brand, productUrl: row.productUrl };
}

function extraction(
  overrides: Partial<NonNullable<Parameters<typeof linkDetailOf>[2]>> = {},
): NonNullable<Parameters<typeof linkDetailOf>[2]> {
  return {
    status: "done",
    hasSpecs: true,
    createdAt: abandonedBefore() + 3600,
    sourceUrl: "https://www.rabbit.run/p/rover",
    ...overrides,
  };
}

describe("linkDetailOf: E's link and its one line (round 43 #94-95)", () => {
  beforeEach(resetSafetyTables);

  it("names the page that was read, which may be another runner's site", async () => {
    const detail = await linkDetailOf(
      core(),
      garment(await runner(true)),
      extraction(),
    );
    expect(detail).toEqual({
      link: "https://janji.com/p/rover",
      outcome: { kind: "found", source: "rabbit.run" },
      specSource: "rabbit.run",
    });
  });

  it("says the page had nothing when enrichment wrote no column", async () => {
    const detail = await linkDetailOf(
      core(),
      garment(await runner(true)),
      extraction({ hasSpecs: false }),
    );
    expect(detail.outcome).toEqual({ kind: "nothing", source: "rabbit.run" });
  });

  it("is still reading a pending product, and one whose claim never landed", async () => {
    const userId = await runner(true);
    for (const status of ["pending", "none"] as const) {
      const detail = await linkDetailOf(
        core(),
        garment(userId),
        extraction({ status }),
      );
      expect(detail.outcome).toEqual({ kind: "reading" });
    }
  });

  it("is trying again on a failure inside the product's first day, and not after", async () => {
    const userId = await runner(true);
    const recent = await linkDetailOf(
      core(),
      garment(userId),
      extraction({ status: "failed", createdAt: abandonedBefore() + 60 }),
    );
    const old = await linkDetailOf(
      core(),
      garment(userId),
      extraction({ status: "failed", createdAt: abandonedBefore() - 60 }),
    );
    expect(recent.outcome).toEqual({
      kind: "unread",
      source: "rabbit.run",
      isRetrying: true,
    });
    expect(old.outcome).toEqual({
      kind: "unread",
      source: "rabbit.run",
      isRetrying: false,
    });
  });

  it("names no site when the page that was read is on a denied domain", async () => {
    const userId = await runner(true);
    await denyDomain("rabbit.run", userId);
    const detail = await linkDetailOf(core(), garment(userId), extraction());
    expect(detail).toEqual({
      link: "https://janji.com/p/rover",
      outcome: { kind: "found", source: undefined },
      specSource: undefined,
    });
  });

  it("shows no link and no line for a link denied since it was saved", async () => {
    const userId = await runner(true);
    await denyDomain("janji.com", userId);
    const detail = await linkDetailOf(core(), garment(userId), extraction());
    // The composition kicker still names its source: that is the product's,
    // not this garment's link.
    expect(detail).toEqual({
      link: undefined,
      outcome: undefined,
      specSource: "rabbit.run",
    });
  });

  it("shows no line for a garment with no link", async () => {
    const { productUrl } = await unsetColumns();
    const detail = await linkDetailOf(
      core(),
      garment(await runner(true), { productUrl }),
      undefined,
    );
    expect(detail).toEqual({
      link: undefined,
      outcome: undefined,
      specSource: undefined,
    });
  });

  it("asks for a brand and model when there is no product to read", async () => {
    const userId = await runner(true);
    const unset = await unsetColumns();
    for (const brand of [unset.brand, "  "]) {
      const detail = await linkDetailOf(
        core(),
        garment(userId, { brand }),
        undefined,
      );
      expect(detail.outcome).toEqual({ kind: "noIdentity" });
    }
  });

  it("asks for a model when the brand sits on the tap list's own name", async () => {
    const detail = await linkDetailOf(
      core(),
      garment(await runner(false), {
        category: "top",
        name: "Merino base layer",
        brand: "Smartwool",
      }),
      undefined,
    );
    expect(detail.outcome).toEqual({ kind: "noIdentity" });
  });

  it("waits on a confirmation for an unconfirmed runner with a brand and model", async () => {
    const detail = await linkDetailOf(
      core(),
      garment(await runner(false)),
      undefined,
    );
    expect(detail.outcome).toEqual({ kind: "unconfirmed" });
  });

  it("puts no brand ahead of no confirmation, a blank brand included", async () => {
    const userId = await runner(false);
    const unset = await unsetColumns();
    for (const brand of [unset.brand, "  "]) {
      const detail = await linkDetailOf(
        core(),
        garment(userId, { brand }),
        undefined,
      );
      expect(detail.outcome).toEqual({ kind: "noIdentity" });
    }
  });

  describe("on the second the first day ends", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("has stopped trying again, as the sweep has", async () => {
      // The sweep re-drives a failure while `created_at > abandonedBefore()`
      // (enrichment's `markFailed`), so the line must agree at the boundary.
      const userId = await runner(true);
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-31T12:00:00.000Z"));
      const detail = await linkDetailOf(
        core(),
        garment(userId),
        extraction({ status: "failed", createdAt: abandonedBefore() }),
      );
      expect(detail.outcome).toEqual({
        kind: "unread",
        source: "rabbit.run",
        isRetrying: false,
      });
    });
  });
});
