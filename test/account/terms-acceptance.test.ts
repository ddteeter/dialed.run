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
  termsPromptView,
  termsStanding,
  termsVersionOf,
} from "../../src/modules/account/terms-acceptance";

/**
 * ACC-6: the terms' version is read from the terms, an acceptance is one
 * row per version, and a runner below the current version is behind.
 */
const db = drizzle(env.DIALED_CORE);

function acceptedBy(userId: string) {
  return db
    .select({
      version: termsAcceptances.version,
      acceptedAt: termsAcceptances.acceptedAt,
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
    for (const text of ["# Terms\n\nNo version.", "Version 2.", "**Version two.**"]) {
      expect(() => termsVersionOf(text)).toThrow(
        'the terms need a "**Version N.**" line',
      );
    }
  });
});

describe("currentTermsVersion", () => {
  it("is the version docs/legal/terms.md declares, which is 1 today", () => {
    // Pinned against the file's own line: bump the text's version and this
    // is the one place that has to agree.
    expect(terms).toMatch(/^\*\*Version 1\.\*\* Effective:/mu);
    expect(currentTermsVersion()).toBe(1);
    expect(currentTermsVersion("**Version 4.**")).toBe(4);
  });
});

describe("termsStanding", () => {
  it("is behind with no acceptance, current at the version, and behind again after a bump", async () => {
    const userId = newUlid();
    expect(await termsStanding(db, userId, 1)).toBe("behind");
    await acceptanceOf(db, userId, 1, 100);
    expect(await termsStanding(db, userId, 1)).toBe("current");
    expect(await termsStanding(db, userId, 2)).toBe("behind");
  });

  it("reads the latest acceptance, not the first, and only the runner's own", async () => {
    const userId = newUlid();
    await acceptanceOf(db, userId, 3, 300);
    await acceptanceOf(db, userId, 1, 100);
    await acceptanceOf(db, newUlid(), 9, 900);
    expect(await termsStanding(db, userId, 3)).toBe("current");
    expect(await termsStanding(db, userId, 4)).toBe("behind");
    expect(await termsStanding(db, newUlid(), 1)).toBe("behind");
  });

  it("measures against the shipped terms by default", async () => {
    const userId = newUlid();
    await acceptanceOf(db, userId, currentTermsVersion(), 100);
    expect(await termsStanding(db, userId)).toBe("current");
  });
});

describe("acceptTerms", () => {
  it("records the version shown, once, keeping the first time", async () => {
    const userId = newUlid();
    expect(await acceptTerms(db, userId, 2, 2, 100)).toBe("accepted");
    expect(await acceptTerms(db, userId, 2, 2, 200)).toBe("accepted");
    expect(await acceptedBy(userId)).toStrictEqual([
      { version: 2, acceptedAt: 100 },
    ]);
  });

  it("keeps the history across a bump", async () => {
    const userId = newUlid();
    await acceptTerms(db, userId, 1, 1, 100);
    await acceptTerms(db, userId, 2, 2, 200);
    expect(await acceptedBy(userId)).toStrictEqual([
      { version: 1, acceptedAt: 100 },
      { version: 2, acceptedAt: 200 },
    ]);
  });

  it("records nothing for a version that is no longer current", async () => {
    const userId = newUlid();
    expect(await acceptTerms(db, userId, 1, 2, 100)).toBe("stale");
    expect(await acceptedBy(userId)).toStrictEqual([]);
  });

  it("records the shipped version now by default", async () => {
    const userId = newUlid();
    const before = nowSeconds();
    expect(await acceptTerms(db, userId, currentTermsVersion())).toBe(
      "accepted",
    );
    const [row] = await acceptedBy(userId);
    expect(row?.version).toBe(currentTermsVersion());
    expect(row?.acceptedAt).toBeGreaterThanOrEqual(before);
  });
});

describe("termsPromptView", () => {
  it("asks a runner who is behind, with the version it asks about", async () => {
    const userId = newUlid();
    expect(await termsPromptView(db, userId, 3)).toStrictEqual({
      state: "ask",
      version: 3,
    });
    expect(await termsPromptView(db, userId)).toStrictEqual({
      state: "ask",
      version: currentTermsVersion(),
    });
  });

  it("has nothing for a runner who is current, or for nobody", async () => {
    const userId = newUlid();
    await acceptanceOf(db, userId, 3, 100);
    expect(await termsPromptView(db, userId, 3)).toStrictEqual({
      state: "none",
    });
    expect(await termsPromptView(db, undefined, 3)).toStrictEqual({
      state: "none",
    });
  });
});
