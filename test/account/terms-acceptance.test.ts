import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import terms from "../../docs/legal/terms.md?raw";
import { termsAcceptances } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import {
  acceptTerms,
  acceptanceOf,
  currentTermsVersion,
  signUpAcceptances,
  termsPromptView,
  termsStanding,
  termsStandingOf,
  termsVersionOf,
} from "../../src/modules/account/terms-acceptance";

/**
 * ACC-6: the terms' version is read from the published terms, an
 * acceptance is one row per version, and a runner below the current
 * version is behind — while no terms are published, nobody is (D-93).
 */
const db = drizzle(env.DIALED_CORE);

/**
 * The owner's published mark, written out: what turns the draft into the
 * current terms.
 */
const MARK = "---\npublished: true\n---\n";

function acceptedBy(userId: string) {
  return db
    .select({
      version: termsAcceptances.version,
      acceptedAt: termsAcceptances.acceptedAt,
      how: termsAcceptances.how,
    })
    .from(termsAcceptances)
    .where(eq(termsAcceptances.userId, userId))
    .orderBy(termsAcceptances.version);
}

describe("termsVersionOf", () => {
  it("reads the version line, wherever it sits, and only at a line's start", () => {
    expect(termsVersionOf("**Version 1.** Effective: today")).toBe(1);
    expect(
      termsVersionOf(
        "> See **Version 9.** in the banner\n\n# Terms\n\n**Version 12.** Effective",
      ),
    ).toBe(12);
  });

  it("refuses terms with no version line", () => {
    for (const text of [
      "# Terms\n\nNo version.",
      "Version 2.",
      "**Version two.**",
    ]) {
      expect(() => termsVersionOf(text)).toThrow(
        'the terms need a "**Version N.**" line',
      );
    }
  });
});

describe("currentTermsVersion", () => {
  it("is nothing while docs/legal/terms.md is unpublished, as it is today", () => {
    // Pinned against the file: the draft declares version 1 and carries no
    // mark, so there are no current terms to accept (D-93).
    expect(terms).toMatch(/^\*\*Version 1\.\*\* Effective:/mu);
    expect(terms.startsWith(MARK)).toBe(false);
    expect(currentTermsVersion()).toBeUndefined();
    expect(currentTermsVersion("**Version 4.**")).toBeUndefined();
  });

  it("is the published text's version line once the owner marks it", () => {
    expect(currentTermsVersion(`${MARK}${terms}`)).toBe(1);
    expect(currentTermsVersion(`${MARK}# Terms\n\n**Version 4.**`)).toBe(4);
  });

  it("refuses published terms with no version line", () => {
    expect(() => currentTermsVersion(`${MARK}# Terms`)).toThrow(
      'the terms need a "**Version N.**" line',
    );
  });
});

describe("termsStandingOf", () => {
  it("asks nothing of anyone while no terms are published", () => {
    for (const latest of [undefined, 1, 9]) {
      expect(termsStandingOf(latest, undefined)).toStrictEqual({
        state: "unpublished",
      });
    }
  });

  it("is behind with no acceptance or an older one, asking for the current version", () => {
    for (const latest of [undefined, 2]) {
      expect(termsStandingOf(latest, 3)).toStrictEqual({
        state: "behind",
        version: 3,
      });
    }
  });

  it("is current at the version, or past it", () => {
    expect(termsStandingOf(3, 3)).toStrictEqual({ state: "current" });
    expect(termsStandingOf(4, 3)).toStrictEqual({ state: "current" });
  });
});

describe("termsStanding", () => {
  it("is behind with no acceptance, current at the version, and behind again after a bump", async () => {
    const userId = newUlid();
    expect(await termsStanding(db, userId, 1)).toStrictEqual({
      state: "behind",
      version: 1,
    });
    await acceptanceOf(db, userId, 1, 100, "page");
    expect(await termsStanding(db, userId, 1)).toStrictEqual({
      state: "current",
    });
    expect(await termsStanding(db, userId, 2)).toStrictEqual({
      state: "behind",
      version: 2,
    });
  });

  it("reads the latest acceptance, not the first, and only the runner's own", async () => {
    const userId = newUlid();
    await acceptanceOf(db, userId, 3, 300, "page");
    await acceptanceOf(db, userId, 1, 100, "page");
    await acceptanceOf(db, newUlid(), 9, 900, "page");
    const atThree = await termsStanding(db, userId, 3);
    const atFour = await termsStanding(db, userId, 4);
    const stranger = await termsStanding(db, newUlid(), 1);
    expect(atThree.state).toBe("current");
    expect(atFour.state).toBe("behind");
    expect(stranger.state).toBe("behind");
  });

  it("measures against the shipped terms by default: unpublished, so nobody is behind", async () => {
    expect(await termsStanding(db, newUlid())).toStrictEqual({
      state: "unpublished",
    });
  });
});

describe("signUpAcceptances", () => {
  it("is the published version's acceptance, for the sign-up's batch", async () => {
    const userId = newUlid();
    const [acceptance] = signUpAcceptances(db, userId, 2, 100);
    if (acceptance === undefined) throw new Error("no acceptance to record");
    await db.batch([acceptance]);
    expect(await acceptedBy(userId)).toStrictEqual([
      { version: 2, acceptedAt: 100, how: "sign-up" },
    ]);
  });

  it("is nothing while no terms are published", () => {
    expect(signUpAcceptances(db, newUlid(), undefined, 100)).toStrictEqual([]);
  });
});

describe("acceptanceOf", () => {
  it("keeps the first acceptance's way, as it keeps its time", async () => {
    const userId = newUlid();
    await acceptanceOf(db, userId, 1, 100, "sign-up");
    await acceptanceOf(db, userId, 1, 200, "page");
    expect(await acceptedBy(userId)).toStrictEqual([
      { version: 1, acceptedAt: 100, how: "sign-up" },
    ]);
  });
});

describe("acceptTerms", () => {
  it("records the version shown, once, keeping the first time", async () => {
    const userId = newUlid();
    expect(await acceptTerms(db, userId, 2, 2, 100)).toBe("accepted");
    expect(await acceptTerms(db, userId, 2, 2, 200)).toBe("accepted");
    expect(await acceptedBy(userId)).toStrictEqual([
      { version: 2, acceptedAt: 100, how: "page" },
    ]);
  });

  it("keeps the history across a bump", async () => {
    const userId = newUlid();
    await acceptTerms(db, userId, 1, 1, 100);
    await acceptTerms(db, userId, 2, 2, 200);
    expect(await acceptedBy(userId)).toStrictEqual([
      { version: 1, acceptedAt: 100, how: "page" },
      { version: 2, acceptedAt: 200, how: "page" },
    ]);
  });

  it("records nothing for a version that is no longer current", async () => {
    const userId = newUlid();
    expect(await acceptTerms(db, userId, 1, 2, 100)).toBe("stale");
    expect(await acceptedBy(userId)).toStrictEqual([]);
  });

  it("records the current version now by default", async () => {
    const userId = newUlid();
    const before = nowSeconds();
    expect(await acceptTerms(db, userId, 3, 3)).toBe("accepted");
    const [row] = await acceptedBy(userId);
    expect(row?.version).toBe(3);
    expect(row?.acceptedAt).toBeGreaterThanOrEqual(before);
  });

  it("records nothing while no terms are published — the shipped draft included", async () => {
    const userId = newUlid();
    expect(await acceptTerms(db, userId, 1, undefined, 100)).toBe("stale");
    expect(await acceptTerms(db, userId, 1)).toBe("stale");
    expect(await acceptedBy(userId)).toStrictEqual([]);
  });
});

describe("termsPromptView", () => {
  it("asks a runner who is behind, with the version it asks about", async () => {
    const userId = newUlid();
    await acceptanceOf(db, userId, 2, 100, "page");
    expect(await termsPromptView(db, userId, 3)).toStrictEqual({
      state: "ask",
      version: 3,
    });
  });

  it("has nothing for a runner who is current, or for nobody", async () => {
    const userId = newUlid();
    await acceptanceOf(db, userId, 3, 100, "page");
    expect(await termsPromptView(db, userId, 3)).toStrictEqual({
      state: "none",
    });
    expect(await termsPromptView(db, undefined, 3)).toStrictEqual({
      state: "none",
    });
  });

  it("has nothing for anyone while no terms are published, as today", async () => {
    const userId = newUlid();
    expect(await termsPromptView(db, userId)).toStrictEqual({ state: "none" });
  });
});
