import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import { notifications } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import { nowSeconds } from "../../src/lib/now";
import { legalDoc, legalPage } from "../../src/modules/account/legal";

/**
 * The legal pages' texts (ACC-13): only a finished text is published, and
 * a signed-in reader gets the bell's count for the signed-in shell.
 */
const db = drizzle(env.DIALED_CORE);

const MARK = "---\npublished: true\n---\n";

const FINISHED = {
  privacy: `${MARK}# Privacy policy\n\n## Who we are\n\nUs.`,
  terms: `${MARK}# Terms\n\n## The rules\n\nBe decent.`,
  copyright: `${MARK}# Copyright\n\n## Where to send a notice\n\nHere.`,
};

/**
The same texts, which the owner has not marked published.
*/
const UNMARKED = {
  privacy: FINISHED.privacy.slice(MARK.length),
  terms: FINISHED.terms.slice(MARK.length),
  copyright: FINISHED.copyright.slice(MARK.length),
};

describe("legalDoc", () => {
  it.each(["privacy", "terms", "copyright"] as const)(
    "publishes nothing while the %s text is the owner's unreviewed draft",
    (slug) => {
      expect(legalDoc(slug)).toBeUndefined();
    },
  );

  it("publishes nothing for a finished-looking text the owner has not marked", () => {
    expect(legalDoc("privacy", UNMARKED)).toBeUndefined();
    expect(legalDoc("terms", UNMARKED)).toBeUndefined();
  });

  it("publishes each finished text as its own page, parsed", () => {
    expect(legalDoc("privacy", FINISHED)).toMatchObject({
      title: "Privacy policy",
      contents: [{ id: "who-we-are", title: "Who we are" }],
    });
    expect(legalDoc("terms", FINISHED)).toMatchObject({
      title: "Terms",
      contents: [{ id: "the-rules", title: "The rules" }],
    });
    expect(legalDoc("copyright", FINISHED)).toMatchObject({
      title: "Copyright",
      contents: [
        { id: "where-to-send-a-notice", title: "Where to send a notice" },
      ],
    });
  });
});

describe("legalPage", () => {
  it("gives a signed-out reader no count, so the page wears the signed-out shell", async () => {
    await expect(
      legalPage(db, "privacy", undefined, FINISHED),
    ).resolves.toMatchObject({
      unreadCount: undefined,
      doc: { title: "Privacy policy" },
    });
  });

  it("gives a signed-in reader their unread count", async () => {
    const userId = newUlid();
    await db.insert(notifications).values([
      {
        id: newUlid(),
        userId,
        kind: "follow",
        subjectId: "a",
        body: "one",
        createdAt: nowSeconds(),
      },
      {
        id: newUlid(),
        userId,
        kind: "follow",
        subjectId: "b",
        body: "two",
        createdAt: nowSeconds(),
      },
    ]);
    const page = await legalPage(db, "privacy", userId);
    expect(page).toStrictEqual({ doc: undefined, unreadCount: 2 });
  });
});
