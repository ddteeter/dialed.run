import { describe, expect, it } from "vitest";

import { withBell } from "../../src/modules/notifications/with-bell";

/**
 * A belled page's loader (design 172): the page's data and the bell, side
 * by side, each under its own name.
 */
describe("withBell", () => {
  it("returns the page's data and the bell, each under its own name", async () => {
    await expect(
      withBell(Promise.resolve({ connected: true }), Promise.resolve(3)),
    ).resolves.toEqual({ data: { connected: true }, bell: 3 });
  });

  it("fails when either read fails", async () => {
    const failure = new Error("bell failed");
    await expect(
      withBell(Promise.resolve(1), Promise.reject(failure)),
    ).rejects.toBe(failure);
  });
});
