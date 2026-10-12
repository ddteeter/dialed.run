import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { userProfiles } from "../../src/db/schema-core";
import { env } from "../../src/env";
import { entryDetailForViewer } from "../../src/modules/feed/entries";
import {
  otherProfile,
  ownProfile,
  profileAtHandle,
} from "../../src/modules/feed/profiles";
import { setRegion } from "../../src/modules/onboarding/aggregate-prefs";
import { makeEntry, makeRun, makeVerifiedUser, resetTables } from "./helpers";

/**
 * Round 30 (d): a region is "used only in aggregates, never shown on a
 * profile or entry", and Settings promises "Never shown to anyone." This
 * observes it, rather than reading source for names: a runner with a
 * region set, and every read a profile or an entry page is built from,
 * for the runner and for someone else.
 */
function db() {
  return drizzle(env.DIALED_CORE);
}

/**
Neither the region's codes nor a field for it appear anywhere in `read`.
*/
function expectNoRegion(read: unknown): void {
  const text = JSON.stringify(read);
  expect(text).toBeDefined();
  expect(text).not.toContain("US-MN");
  expect(text).not.toMatch(/region/iu);
}

beforeEach(async () => {
  await resetTables();
});

describe("a runner's region (round 30 (d))", () => {
  it("is on no profile and no entry, for the runner or anyone else", async () => {
    const runner = await makeVerifiedUser();
    const viewer = await makeVerifiedUser();
    await setRegion(db(), runner, { country: "US", subdivision: "US-MN" });
    const entryId = await makeEntry({
      userId: runner,
      runId: await makeRun({ userId: runner }),
      audience: "runners",
      verdict: 0,
    });
    const [row] = await db()
      .select({ username: userProfiles.username })
      .from(userProfiles)
      .where(eq(userProfiles.userId, runner))
      .limit(1);
    const handle = row?.username ?? "";
    expect(handle).not.toBe("");

    const reads = {
      own: await ownProfile(runner),
      other: await otherProfile(runner, viewer),
      atHandle: await profileAtHandle(viewer, handle),
      entryForRunner: await entryDetailForViewer(entryId, runner),
      entryForViewer: await entryDetailForViewer(entryId, viewer),
    };

    // Each read found the runner, so its silence about the region is
    // the read's and not a miss.
    expect(reads.other?.userId).toBe(runner);
    expect(JSON.stringify(reads.atHandle)).toContain(runner);
    expect(reads.entryForViewer?.id).toBe(entryId);
    for (const read of Object.values(reads)) expectNoRegion(read);
  });
});
