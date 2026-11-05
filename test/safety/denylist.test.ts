import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/d1";

import { domainDenylist, linkLandings } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { garmentSchema } from "../../src/lib/contracts";
import {
  createItem,
  DeniedLinkError,
  updateItem,
} from "../../src/modules/closet/service";
import {
  deniedLinksOf,
  denyDomain,
  isDeniedLink,
  isDeniedOnLanding,
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

  it("denies nothing until someone says so", async () => {
    expect(await isDeniedLink("https://janji.com/x")).toBe(false);
  });

  it("denies a domain a reviewer added", async () => {
    await denyDomain("spam.example", await makeUser(), "link farm");
    expect(await isDeniedLink("https://spam.example/x")).toBe(true);
  });

  it("normalises what the reviewer pasted", async () => {
    // A reviewer's clipboard holds the URL, not the bare host. Both must
    // land on the same row or the entry silently misses.
    await denyDomain("https://www.spam.example/some/page", await makeUser());
    expect(await isDeniedLink("https://spam.example/other")).toBe(true);
    expect(await isDeniedLink("https://www.spam.example/")).toBe(true);
  });

  it("normalises a bare host the same way, down to the www and the spaces", async () => {
    // The other branch: `domainOf` handles anything with a scheme, and a
    // reviewer who types the host alone falls through to a separate
    // normaliser. If the two disagree, a denial lands on a row no link
    // ever matches — "  WWW.Spam.Example " and "spam.example" must be
    // one domain.
    await denyDomain("  WWW.Spam.Example ", await makeUser());

    expect(await isDeniedLink("https://spam.example/x")).toBe(true);
    expect(await isDeniedLink("https://www.spam.example/x")).toBe(true);
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
    expect(await isDeniedLink("https://notspam.example/x")).toBe(false);
    expect(await isDeniedLink("https://spam.example.org/x")).toBe(false);
  });

  it("treats a garment with no link at all as not denied", async () => {
    await denyDomain("spam.example", await makeUser());
    // The closet's save path asks this about every garment, most of which
    // have no link. Answering here rather than guarding at the call site
    // is what makes the rule testable.
    expect(await isDeniedLink(undefined)).toBe(false);
  });

  it("treats an unparseable link as not denied, which is a different answer", async () => {
    await denyDomain("spam.example", await makeUser());
    // Invalid and denied are different facts with different messages;
    // conflating them tells a runner their good link was blocked.
    expect(await isDeniedLink("not a url")).toBe(false);
  });

  it("is idempotent, so adding a domain twice is not an error", async () => {
    const reviewer = await makeUser();
    await denyDomain("spam.example", reviewer);
    await denyDomain("spam.example", reviewer);
    expect(await isDeniedLink("https://spam.example/x")).toBe(true);
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

  it("lands on the link field, as F's other field issues do (round 43 #93)", () => {
    expect(new DeniedLinkError().issues).toEqual([
      {
        path: ["productUrl"],
        message: "That link isn't allowed here. The rest of the piece is fine.",
      },
    ]);
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
    expect(await isDeniedLink("https://shop.spam.example/x")).toBe(true);
    expect(await isDeniedLink("https://a.b.spam.example/x")).toBe(true);
  });

  it("does not deny the parent of a denied subdomain", async () => {
    await denyDomain("shop.spam.example", await makeUser());
    expect(await isDeniedLink("https://spam.example/x")).toBe(false);
    expect(await isDeniedLink("https://other.spam.example/x")).toBe(false);
  });

  it("never treats a TLD row as a parent", async () => {
    // A host's last label alone is never one of its suffixes: a row
    // reading "example" must not deny every site under it.
    await denyDomain("example", await makeUser());
    expect(await isDeniedLink("https://spam.example/x")).toBe(false);
  });
});

describe("deniedLinksOf, the batched read every surface asks", () => {
  beforeEach(resetSafetyTables);

  it("answers a mixed batch with the links as given", async () => {
    await denyDomain("spam.example", await makeUser());

    const denied = await deniedLinksOf(core(), [
      "https://www.spam.example/a",
      "https://shop.spam.example/b",
      "https://janji.com/p/tee",
      undefined,
    ]);

    expect(denied).toEqual(
      new Set(["https://www.spam.example/a", "https://shop.spam.example/b"]),
    );
  });

  it("is empty for a batch with no links at all", async () => {
    await denyDomain("spam.example", await makeUser());
    expect(await deniedLinksOf(core(), [])).toEqual(new Set());
    expect(await deniedLinksOf(core(), [undefined])).toEqual(new Set());
  });

  it("never names an unparseable or http link, which is invalid rather than denied", async () => {
    await denyDomain("spam.example", await makeUser());
    expect(
      await deniedLinksOf(core(), [
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
      await deniedLinksOf(drizzle(env.DIALED_CORE), ["https://spam.example/x"]),
    ).toEqual(new Set(["https://spam.example/x"]));
  });
});

describe("a link is denied by where it lands (R-176)", () => {
  beforeEach(resetSafetyTables);

  const LINK = "https://shop.example/out?to=elsewhere";

  it("records a landing on another domain, and denies the link once that domain is", async () => {
    expect(await isDeniedOnLanding(LINK, "https://spam.example/p")).toBe(false);
    expect(await deniedLinksOf(core(), [LINK])).toEqual(new Set());

    await denyDomain("spam.example", await makeUser());
    expect(await deniedLinksOf(core(), [LINK])).toEqual(new Set([LINK]));
    expect(await isDeniedLink(LINK)).toBe(true);
    // The landing denies that link, not its domain.
    expect(await isDeniedLink("https://shop.example/other")).toBe(false);
  });

  it("answers denied at once when the landing is already denied", async () => {
    await denyDomain("spam.example", await makeUser());
    expect(await isDeniedOnLanding(LINK, "https://www.spam.example/p")).toBe(
      true,
    );
    expect(await isDeniedLink(LINK)).toBe(true);
  });

  it("denies by a denied parent of the landing, as for a typed link", async () => {
    await denyDomain("spam.example", await makeUser());
    expect(
      await isDeniedOnLanding(LINK, "https://cdn.shop.spam.example/p"),
    ).toBe(true);
  });

  it("answers by the link's own domain when it lands at home, and keeps no row", async () => {
    expect(await isDeniedOnLanding(LINK, "https://www.shop.example/p")).toBe(
      false,
    );
    await denyDomain("shop.example", await makeUser());
    expect(await isDeniedOnLanding(LINK, "https://shop.example/p")).toBe(true);
    await expectNoLanding(LINK);
  });

  it("keeps only the latest landing for a link", async () => {
    await isDeniedOnLanding(LINK, "https://first.example/p");
    await isDeniedOnLanding(LINK, "https://second.example/p");
    const rows = await core().select().from(linkLandings);
    expect(rows.map((row) => [row.url, row.landedDomain])).toEqual([
      [LINK, "second.example"],
    ]);

    await denyDomain("first.example", await makeUser());
    expect(await isDeniedLink(LINK)).toBe(false);
  });

  it("stamps when the landing was checked, in seconds", async () => {
    const before = nowSeconds();
    await isDeniedOnLanding(LINK, "https://elsewhere.example/p");
    const [row] = await core().select().from(linkLandings);
    expect(row?.checkedAt).toBeGreaterThanOrEqual(before);
    expect(row?.checkedAt).toBeLessThanOrEqual(nowSeconds());
  });

  it("refuses a read that landed with no https domain, and keeps no row", async () => {
    expect(
      await isDeniedOnLanding(
        LINK,
        ["http:", "//elsewhere.example/p"].join(""),
      ),
    ).toBe(true);
    expect(await isDeniedOnLanding(LINK, "not a url")).toBe(true);
    await expectNoLanding(LINK);
    expect(await isDeniedLink(LINK)).toBe(false);
  });

  it("answers a batch from both tables in one call", async () => {
    await denyDomain("spam.example", await makeUser());
    await isDeniedOnLanding(LINK, "https://spam.example/p");
    await isDeniedOnLanding("https://fine.example/x", "https://ok.example/p");
    expect(
      await deniedLinksOf(core(), [
        LINK,
        "https://fine.example/x",
        "https://spam.example/typed",
        "https://janji.com/p",
      ]),
    ).toEqual(new Set([LINK, "https://spam.example/typed"]));
  });
});

async function expectNoLanding(url: string): Promise<void> {
  const rows = await core()
    .select()
    .from(linkLandings)
    .where(eq(linkLandings.url, url));
  expect(rows).toEqual([]);
}
