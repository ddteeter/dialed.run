import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/d1";

import { domainDenylist } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { deniedLinksOf } from "../../src/modules/safety";

/**
 * The denylist's seed (R-176, migration 0078): link shorteners and
 * redirectors are denied from a fresh database, before any operator has
 * said a word. No reset here — the seed is what is under test.
 */
const SHORTENERS = [
  "bit.ly",
  "bitly.com",
  "tinyurl.com",
  "t.co",
  "goo.gl",
  "ow.ly",
  "buff.ly",
  "is.gd",
  "v.gd",
  "rebrand.ly",
  "cutt.ly",
  "shorturl.at",
  "rb.gy",
  "tiny.cc",
  "s.id",
  "t.ly",
  "bl.ink",
  "shorte.st",
  "adf.ly",
  "lnkd.in",
  "fb.me",
  "qr.ae",
];
const REDIRECTORS = [
  "l.facebook.com",
  "lm.facebook.com",
  "l.instagram.com",
  "out.reddit.com",
  "l.messenger.com",
  "href.li",
  "anon.to",
  "dereferer.org",
  "nullrefer.com",
];

function core() {
  return drizzle(env.DIALED_CORE);
}

describe("the denylist's seed", () => {
  it("holds exactly the owner's list, marked as the seed", async () => {
    const rows = await core().select().from(domainDenylist);
    const reasons = new Map(rows.map((row) => [row.domain, row.reason]));
    expect(new Set(reasons.keys())).toEqual(
      new Set([...SHORTENERS, ...REDIRECTORS]),
    );
    for (const domain of SHORTENERS) {
      expect(reasons.get(domain), domain).toBe("link shortener (R-176)");
    }
    for (const domain of REDIRECTORS) {
      expect(reasons.get(domain), domain).toBe("link redirector (R-176)");
    }
    expect(new Set(rows.map((row) => row.addedBy))).toEqual(new Set(["seed"]));
  });

  it("denies a shortened link, and a redirector's subdomain but not its site", async () => {
    const links = [
      "https://bit.ly/3xYz",
      "https://www.tinyurl.com/abc",
      "https://l.facebook.com/l.php?u=x",
      "https://www.facebook.com/somebrand",
      "https://amzn.to/abc",
    ];
    expect(await deniedLinksOf(core(), links)).toEqual(
      new Set([
        "https://bit.ly/3xYz",
        "https://www.tinyurl.com/abc",
        "https://l.facebook.com/l.php?u=x",
      ]),
    );
  });
});
