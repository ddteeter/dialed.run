import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { userProfiles } from "../../src/db/schema-core";
import { themeInput } from "../../src/modules/account/inputs";
import { ownTheme, setOwnTheme } from "../../src/modules/account/theme";
import { withOwnTheme } from "../../src/modules/account/theme-answer";
import { THEME_CHOICES, themeChoiceSchema } from "../../src/lib/contracts";
import { newUlid } from "../../src/lib/ids";
import { core } from "../email/helpers";
import { makeUser, resetTables } from "../feed/helpers";

/**
 * U1 › Display › Theme (R48·133, design 185): the account's value.
 */
const db = core();

beforeEach(async () => {
  await resetTables();
});

describe("the theme column", () => {
  it("follows the system for a profile that never chose", async () => {
    const userId = await makeUser();

    expect(await ownTheme(db, userId)).toBe("system");
  });

  it("follows the system for a runner with no profile row, and for nobody", async () => {
    expect(await ownTheme(db, newUlid())).toBe("system");
    expect(await ownTheme(db, undefined)).toBe("system");
  });

  it.each(THEME_CHOICES)("saves %s and reads it back", async (theme) => {
    const userId = await makeUser();

    expect(await setOwnTheme(db, userId, theme)).toStrictEqual({ theme });
    expect(await ownTheme(db, userId)).toBe(theme);
  });

  it("creates the row for a runner who has none, and touches nothing else", async () => {
    const fresh = newUlid();
    await setOwnTheme(db, fresh, "dark");
    expect(await ownTheme(db, fresh)).toBe("dark");

    const userId = await makeUser({ tempUnit: "c" });
    await setOwnTheme(db, userId, "light");
    const [row] = await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId));
    expect(row?.tempUnit).toBe("c");
    expect(row?.theme).toBe("light");
  });

  it("reads one runner's choice, not another's", async () => {
    const mine = await makeUser();
    const theirs = await makeUser();
    await setOwnTheme(db, theirs, "dark");

    expect(await ownTheme(db, mine)).toBe("system");
  });

  it("stores the contract's values and no others", () => {
    expect(themeChoiceSchema.options).toStrictEqual(["system", "light", "dark"]);
    expect(userProfiles.theme.enumValues).toStrictEqual(THEME_CHOICES);
    expect(themeInput.safeParse({ theme: "sepia" }).success).toBe(false);
    expect(themeInput.parse({ theme: "dark" })).toStrictEqual({
      theme: "dark",
    });
  });
});

describe("withOwnTheme", () => {
  it("adds the runner's theme to a signed-in answer", async () => {
    const askTheme = vi.fn(() => Promise.resolve("dark" as const));
    const ask = withOwnTheme(
      () => Promise.resolve({ signedIn: true, email: "a@b.c" }),
      askTheme,
    );

    expect(await ask()).toStrictEqual({
      signedIn: true,
      email: "a@b.c",
      theme: "dark",
    });
  });

  it("answers the system for nobody, without asking", async () => {
    const askTheme = vi.fn(() => Promise.resolve("dark" as const));
    const ask = withOwnTheme(
      () => Promise.resolve({ signedIn: false }),
      askTheme,
    );

    expect(await ask()).toStrictEqual({ signedIn: false, theme: "system" });
    expect(askTheme).not.toHaveBeenCalled();
  });
});
