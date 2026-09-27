import { describe, expect, it } from "vitest";

import { env } from "../../src/env";
import { isEmailWanted } from "../../src/modules/email";
import { oneClickUnsubscribeResponse } from "../../src/modules/email/one-click";
import { unsubscribeUrl } from "../../src/modules/email/unsubscribe";
import { core, ORIGIN, seedUser } from "./helpers";

/**
 * The landing route's POST handler (RFC 8058): the one function that reads
 * `env.DIALED_CORE` and `env.BETTER_AUTH_SECRET` directly, so it is not
 * importable by the tests that exercise `oneClickUnsubscribe` through a
 * fake db and a fixed secret — this is the seam that reads the real
 * bindings instead.
 */

const db = core();

describe("oneClickUnsubscribeResponse", () => {
  it("reads the platform's own binding and secret to turn a kind off", async () => {
    const { userId } = await seedUser();
    const url = await unsubscribeUrl(
      ORIGIN,
      env.BETTER_AUTH_SECRET,
      userId,
      "run_reminder",
    );

    const response = await oneClickUnsubscribeResponse(
      new Request(url, { method: "POST", body: "List-Unsubscribe=One-Click" }),
    );

    expect(response.status).toBe(200);
    expect(await isEmailWanted(db, userId, "run_reminder")).toBe(false);
  });

  it("refuses a tampered link with a 400, off the same binding", async () => {
    const { userId } = await seedUser();
    const url = await unsubscribeUrl(
      ORIGIN,
      env.BETTER_AUTH_SECRET,
      userId,
      "run_reminder",
    );
    const tampered = new URL(url);
    tampered.searchParams.set("s", "tampered");

    const response = await oneClickUnsubscribeResponse(
      new Request(tampered, { method: "POST" }),
    );

    expect(response.status).toBe(400);
    expect(await isEmailWanted(db, userId, "run_reminder")).toBe(true);
  });
});
