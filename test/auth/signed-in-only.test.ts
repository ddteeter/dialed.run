import { describe, expect, it, vi } from "vitest";

import { signedInOnly } from "../../src/modules/auth/signed-in-only";

describe("signedInOnly", () => {
  it("loads for a signed-in viewer and hands back what it loaded", async () => {
    const load = vi.fn(() => Promise.resolve({ username: "maya_runs" }));
    await expect(signedInOnly({ user: "maya" }, load)).resolves.toStrictEqual({
      username: "maya_runs",
    });
    expect(load).toHaveBeenCalledOnce();
  });

  it("asks nothing for a signed-out visitor", async () => {
    const load = vi.fn(() => Promise.resolve({ username: "maya_runs" }));
    await expect(signedInOnly(undefined, load)).resolves.toBeUndefined();
    expect(load).not.toHaveBeenCalled();
  });
});
