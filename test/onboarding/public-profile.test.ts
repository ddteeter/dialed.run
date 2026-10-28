import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { outfitEntries, userProfiles } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { newUlid } from "../../src/lib/ids";
import {
  PUBLIC_DEFAULT_NEEDS_PROFILE,
  publicProfileInput,
  sharingDefaultRule,
} from "../../src/modules/onboarding/inputs";
import { currentSettings } from "../../src/modules/onboarding/profile";
import {
  saveSharing,
  setPublicProfile,
} from "../../src/modules/onboarding/public-profile";
import { makeEntry, makeRun, makeUser, resetTables } from "../feed/helpers";

/**
 * D-149's profile switches and the rule tying them to the sharing default
 * (round 41 #86b; design 160 step 4).
 */
function coreDb() {
  return drizzle(env.DIALED_CORE);
}

async function profileOf(userId: string) {
  const [row] = await coreDb()
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);
  return row;
}

async function audienceOf(entryId: string) {
  const [row] = await coreDb()
    .select({ audience: outfitEntries.audience })
    .from(outfitEntries)
    .where(eq(outfitEntries.id, entryId));
  return row?.audience;
}

/**
What a refused save throws, as the form reads it: the issues zod carries.
*/
async function refusalOf(save: Promise<unknown>): Promise<unknown> {
  try {
    await save;
  } catch (error: unknown) {
    return error;
  }
  return undefined;
}

const REFUSED = {
  issues: [
    expect.objectContaining({
      path: ["defaultAudience"],
      message: PUBLIC_DEFAULT_NEEDS_PROFILE,
    }),
  ],
};

beforeEach(async () => {
  await resetTables();
});

describe("saveSharing", () => {
  it("saves a shared or private default for a runner with no row, as any upsert does", async () => {
    const userId = newUlid();
    await saveSharing(coreDb(), userId, { defaultAudience: "private" });
    expect(await profileOf(userId)).toMatchObject({
      defaultAudience: "private",
    });
    await saveSharing(coreDb(), userId, { defaultAudience: "runners" });
    expect(await profileOf(userId)).toMatchObject({
      defaultAudience: "runners",
    });
  });

  it("refuses a PUBLIC default while the profile is off, on the field, and writes nothing", async () => {
    const userId = await makeUser({ defaultAudience: "private" });

    const refusal = await refusalOf(
      saveSharing(coreDb(), userId, { defaultAudience: "world" }),
    );
    expect(refusal).toMatchObject(REFUSED);
    expect(await profileOf(userId)).toMatchObject({
      defaultAudience: "private",
    });
  });

  it("refuses a PUBLIC default for a runner with no row, and creates none", async () => {
    const userId = newUlid();
    const refusal = await refusalOf(
      saveSharing(coreDb(), userId, { defaultAudience: "world" }),
    );
    expect(refusal).toMatchObject(REFUSED);
    expect(await profileOf(userId)).toBeUndefined();
  });

  it("saves a PUBLIC default once the profile is public", async () => {
    const userId = await makeUser();
    await setPublicProfile(coreDb(), userId, { publicProfile: true });

    await saveSharing(coreDb(), userId, { defaultAudience: "world" });
    expect(await profileOf(userId)).toMatchObject({ defaultAudience: "world" });
  });

  it("refuses for the runner whose profile is off, not for another runner's", async () => {
    const open = await makeUser();
    const closed = await makeUser({ defaultAudience: "private" });
    await setPublicProfile(coreDb(), open, { publicProfile: true });

    const refusal = await refusalOf(
      saveSharing(coreDb(), closed, { defaultAudience: "world" }),
    );
    expect(refusal).toMatchObject(REFUSED);
    expect(await profileOf(open)).toMatchObject({ defaultAudience: "runners" });
  });
});

describe("setPublicProfile", () => {
  it("turns the profile on for a runner with no row, closet off, default shared", async () => {
    const userId = newUlid();
    expect(
      await setPublicProfile(coreDb(), userId, { publicProfile: true }),
    ).toStrictEqual({
      publicProfile: true,
      publicCloset: false,
      defaultAudience: "runners",
    });
  });

  it("keeps Show my closet while the profile is off, and the profile while the closet changes", async () => {
    const userId = await makeUser();
    expect(
      await setPublicProfile(coreDb(), userId, { publicCloset: true }),
    ).toMatchObject({ publicProfile: false, publicCloset: true });

    expect(
      await setPublicProfile(coreDb(), userId, { publicProfile: true }),
    ).toMatchObject({ publicProfile: true, publicCloset: true });

    expect(
      await setPublicProfile(coreDb(), userId, { publicCloset: false }),
    ).toMatchObject({ publicProfile: true, publicCloset: false });

    await setPublicProfile(coreDb(), userId, { publicCloset: true });
    expect(
      await setPublicProfile(coreDb(), userId, { publicProfile: false }),
    ).toMatchObject({ publicProfile: false, publicCloset: true });
    expect(await profileOf(userId)).toMatchObject({
      publicProfile: false,
      publicCloset: true,
    });
  });

  it("moves a PUBLIC default to SHARED when the profile goes off, and leaves PUBLIC kits public", async () => {
    const userId = await makeUser();
    await setPublicProfile(coreDb(), userId, { publicProfile: true });
    await saveSharing(coreDb(), userId, { defaultAudience: "world" });
    const kit = await makeEntry({
      userId,
      runId: await makeRun({ userId }),
      audience: "world",
    });

    expect(
      await setPublicProfile(coreDb(), userId, { publicProfile: false }),
    ).toStrictEqual({
      publicProfile: false,
      publicCloset: false,
      defaultAudience: "runners",
    });
    expect(await profileOf(userId)).toMatchObject({
      defaultAudience: "runners",
    });
    expect(await audienceOf(kit)).toBe("world");
  });

  it("leaves a shared or private default where it was when the profile goes off", async () => {
    const quiet = await makeUser({ defaultAudience: "private" });
    const open = await makeUser({ defaultAudience: "runners" });
    for (const userId of [quiet, open]) {
      await setPublicProfile(coreDb(), userId, { publicProfile: true });
    }

    expect(
      await setPublicProfile(coreDb(), quiet, { publicProfile: false }),
    ).toMatchObject({ defaultAudience: "private" });
    expect(
      await setPublicProfile(coreDb(), open, { publicProfile: false }),
    ).toMatchObject({ defaultAudience: "runners" });
  });

  it("keeps a PUBLIC default while the profile stays on", async () => {
    const userId = await makeUser();
    await setPublicProfile(coreDb(), userId, { publicProfile: true });
    await saveSharing(coreDb(), userId, { defaultAudience: "world" });

    expect(
      await setPublicProfile(coreDb(), userId, { publicProfile: true }),
    ).toMatchObject({ defaultAudience: "world" });
    expect(
      await setPublicProfile(coreDb(), userId, { publicCloset: true }),
    ).toMatchObject({ defaultAudience: "world" });
  });

  it("changes only the runner it was given", async () => {
    const userId = await makeUser();
    const other = await makeUser();
    await setPublicProfile(coreDb(), userId, { publicProfile: true });
    expect(await profileOf(other)).toMatchObject({ publicProfile: false });
  });
});

describe("currentSettings reads the switches and the handle", () => {
  it("off, off and no handle for a runner with no row", async () => {
    expect(await currentSettings(coreDb(), newUlid())).toMatchObject({
      publicProfile: false,
      publicCloset: false,
      username: undefined,
    });
  });

  it("as stored", async () => {
    const userId = await makeUser({ username: "maya_runs" });
    await setPublicProfile(coreDb(), userId, { publicProfile: true });
    await setPublicProfile(coreDb(), userId, { publicCloset: true });
    expect(await currentSettings(coreDb(), userId)).toMatchObject({
      publicProfile: true,
      publicCloset: true,
      username: "maya_runs",
    });
  });
});

describe("sharingDefaultRule", () => {
  it("takes PUBLIC only with a public profile, and the others either way", () => {
    expect(
      sharingDefaultRule.safeParse({
        defaultAudience: "world",
        publicProfile: true,
      }).success,
    ).toBe(true);
    for (const defaultAudience of ["private", "runners"]) {
      for (const isPublicProfile of [true, false]) {
        expect(
          sharingDefaultRule.safeParse({ defaultAudience, publicProfile: isPublicProfile })
            .success,
        ).toBe(true);
      }
    }
    const refused = sharingDefaultRule.safeParse({
      defaultAudience: "world",
      publicProfile: false,
    });
    expect(refused.error?.issues).toMatchObject([
      { path: ["defaultAudience"], message: PUBLIC_DEFAULT_NEEDS_PROFILE },
    ]);
  });

  it("says where PUBLIC comes from, in the board's words", () => {
    expect(PUBLIC_DEFAULT_NEEDS_PROFILE).toBe(
      "Public is a choice here once your profile is public.",
    );
  });
});

describe("publicProfileInput", () => {
  it("takes one switch at a time, and nothing else", () => {
    expect(publicProfileInput.parse({ publicProfile: true })).toStrictEqual({
      publicProfile: true,
    });
    expect(publicProfileInput.parse({ publicCloset: false })).toStrictEqual({
      publicCloset: false,
    });
    for (const refused of [
      {},
      { publicProfile: true, publicCloset: true },
      { publicProfile: "yes" },
      { publicCloset: true, defaultAudience: "world" },
    ]) {
      expect(publicProfileInput.safeParse(refused).success).toBe(false);
    }
  });
});
