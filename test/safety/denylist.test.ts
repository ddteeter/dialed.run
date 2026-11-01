import { beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/d1";

import { domainDenylist } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { garmentSchema } from "../../src/lib/contracts";
import {
  createItem,
  DeniedLinkError,
  updateItem,
} from "../../src/modules/closet/service";
import {
  deniedDomainsOf,
  denyDomain,
  isDeniedDomain,
} from "../../src/modules/safety";

import { makeUser, resetSafetyTables } from "./helpers";
import { nowSeconds } from "../../src/lib/now";

function core() {
  return drizzle(env.DIALED_CORE);
}

function garmentWith(url?: string) {
  return garmentSchema.parse({
    category: "top",
    name: "Long sleeve",
    ...(url !== undefined && { productUrl: url }),
  });
}

describe("the denylist itself", () => {
  beforeEach(resetSafetyTables);

  it("is seeded empty, so nothing is denied until someone says so", async () => {
    expect(await isDeniedDomain("https://janji.com/x")).toBe(false);
  });

  it("denies a domain a reviewer added", async () => {
    await denyDomain("spam.example", await makeUser(), "link farm");
    expect(await isDeniedDomain("https://spam.example/x")).toBe(true);
  });

  it("normalises what the reviewer pasted", async () => {
    // A reviewer's clipboard holds the URL, not the bare host. Both must
    // land on the same row or the entry silently misses.
    await denyDomain("https://www.spam.example/some/page", await makeUser());
    expect(await isDeniedDomain("https://spam.example/other")).toBe(true);
    expect(await isDeniedDomain("https://www.spam.example/")).toBe(true);
  });

  it("normalises a bare host the same way, down to the www and the spaces", async () => {
    // The other branch: `domainOf` handles anything with a scheme, and a
    // reviewer who types the host alone falls through to a separate
    // normaliser. If the two disagree, a denial lands on a row no link
    // ever matches — "  WWW.Spam.Example " and "spam.example" must be
    // one domain.
    await denyDomain("  WWW.Spam.Example ", await makeUser());

    expect(await isDeniedDomain("https://spam.example/x")).toBe(true);
    expect(await isDeniedDomain("https://www.spam.example/x")).toBe(true);
  });

  it("stamps when a domain was denied, in seconds", async () => {
    const before = nowSeconds();
    await denyDomain("spam.example", await makeUser());

    const [row] = await core()
      .select({ createdAt: domainDenylist.createdAt })
      .from(domainDenylist);

    // Bounded on both sides: a millisecond value is still "recent" to a
    // one-sided assertion, and every other time column in this schema
    // counts seconds.
    expect(row?.createdAt).toBeGreaterThanOrEqual(before - 5);
    expect(row?.createdAt).toBeLessThanOrEqual(before + 5);
  });

  it("does not deny a different site with a similar name", async () => {
    await denyDomain("spam.example", await makeUser());
    expect(await isDeniedDomain("https://notspam.example/x")).toBe(false);
    expect(await isDeniedDomain("https://spam.example.org/x")).toBe(false);
  });

  it("treats a garment with no link at all as not denied", async () => {
    await denyDomain("spam.example", await makeUser());
    // The closet's save path asks this about every garment, most of which
    // have no link. Answering here rather than guarding at the call site
    // is what makes the rule testable.
    expect(await isDeniedDomain(undefined)).toBe(false);
  });

  it("treats an unparseable link as not denied, which is a different answer", async () => {
    await denyDomain("spam.example", await makeUser());
    // Invalid and denied are different facts with different messages;
    // conflating them tells a runner their good link was blocked.
    expect(await isDeniedDomain("not a url")).toBe(false);
  });

  it("is idempotent, so adding a domain twice is not an error", async () => {
    const reviewer = await makeUser();
    await denyDomain("spam.example", reviewer);
    await denyDomain("spam.example", reviewer);
    expect(await isDeniedDomain("https://spam.example/x")).toBe(true);
  });
});

describe("saving a garment with a denied link", () => {
  beforeEach(resetSafetyTables);

  it("is refused, with a message for the runner", async () => {
    const userId = await makeUser();
    await denyDomain("spam.example", userId);

    await expect(
      createItem(core(), userId, garmentWith("https://spam.example/x")),
    ).rejects.toThrow(DeniedLinkError);
  });

  it("says what happened without naming the list", () => {
    // A message that explained which list, or why, would turn a
    // moderation tool into a probe anyone can query.
    const error = new DeniedLinkError();
    expect(error.message).toContain("isn't allowed here");
    expect(error.message).not.toMatch(/denylist|blocked domain|spam/i);
  });

  it("is refused on edit too, not only on create", async () => {
    const userId = await makeUser();
    const item = await createItem(core(), userId, garmentWith());
    await denyDomain("spam.example", userId);

    // Checked on the way in at BOTH doors. A link already stored is one
    // already rendered to someone.
    await expect(
      updateItem(
        core(),
        userId,
        item.id,
        garmentWith("https://spam.example/x"),
      ),
    ).rejects.toThrow(DeniedLinkError);
  });

  it("leaves an ordinary link alone", async () => {
    const userId = await makeUser();
    await denyDomain("spam.example", userId);

    const item = await createItem(
      core(),
      userId,
      garmentWith("https://janji.com/p/tee"),
    );
    expect(item.productUrl).toBe("https://janji.com/p/tee");
  });

  it("leaves a garment with no link alone", async () => {
    const userId = await makeUser();
    await denyDomain("spam.example", userId);
    const item = await createItem(core(), userId, garmentWith());
    expect(item.id).toBeTruthy();
  });
});

describe("denying a domain denies everything under it (design 163, Q2)", () => {
  beforeEach(resetSafetyTables);

  it("denies a subdomain of a denied host, at any depth", async () => {
    await denyDomain("spam.example", await makeUser());
    expect(await isDeniedDomain("https://shop.spam.example/x")).toBe(true);
    expect(await isDeniedDomain("https://a.b.spam.example/x")).toBe(true);
  });

  it("does not deny the parent of a denied subdomain", async () => {
    await denyDomain("shop.spam.example", await makeUser());
    expect(await isDeniedDomain("https://spam.example/x")).toBe(false);
    expect(await isDeniedDomain("https://other.spam.example/x")).toBe(false);
  });

  it("never treats a TLD row as a parent", async () => {
    // A host's last label alone is never one of its suffixes: a row
    // reading "example" must not deny every site under it.
    await denyDomain("example", await makeUser());
    expect(await isDeniedDomain("https://spam.example/x")).toBe(false);
  });
});

describe("deniedDomainsOf, the batched read every surface asks", () => {
  beforeEach(resetSafetyTables);

  it("answers a mixed batch in domainOf's form", async () => {
    await denyDomain("spam.example", await makeUser());

    const denied = await deniedDomainsOf(core(), [
      "https://www.spam.example/a",
      "https://shop.spam.example/b",
      "https://janji.com/p/tee",
      undefined,
    ]);

    expect(denied).toEqual(new Set(["spam.example", "shop.spam.example"]));
  });

  it("is empty for a batch with no links at all", async () => {
    await denyDomain("spam.example", await makeUser());
    expect(await deniedDomainsOf(core(), [])).toEqual(new Set());
    expect(await deniedDomainsOf(core(), [undefined])).toEqual(new Set());
  });

  it("never names an unparseable or http link, which is invalid rather than denied", async () => {
    await denyDomain("spam.example", await makeUser());
    expect(
      await deniedDomainsOf(core(), [
        "not a url",
        ["http:", "//spam.example/x"].join(""),
      ]),
    ).toEqual(new Set());
  });

  it("reads whichever handle it is given, so a page can ask its replica", async () => {
    // The display read takes the caller's handle (owner Q4). A denial
    // written through one handle is read back through another.
    await denyDomain("spam.example", await makeUser());
    expect(
      await deniedDomainsOf(drizzle(env.DIALED_CORE), [
        "https://spam.example/x",
      ]),
    ).toEqual(new Set(["spam.example"]));
  });
});
