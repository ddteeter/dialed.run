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

const FINISHED = { privacy: "# Privacy policy\n\n## Who we are\n\nUs." };

describe("legalDoc", () => {
  it("publishes nothing while the privacy text is the owner's unreviewed draft", () => {
    expect(legalDoc("privacy")).toBeUndefined();
  });

  it("publishes a finished text, parsed", () => {
    expect(legalDoc("privacy", FINISHED)).toMatchObject({
      title: "Privacy policy",
      contents: [{ id: "who-we-are", title: "Who we are" }],
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
