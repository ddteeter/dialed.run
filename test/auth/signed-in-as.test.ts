import { describe, expect, it } from "vitest";

import { signedInAs } from "../../src/modules/auth/signed-in-as";

describe("signedInAs", () => {
  it("names the runner by handle once they have one", () => {
    expect(signedInAs("maya_runs")).toBe("Signed in as @maya_runs");
  });

  it("says only Signed in before the runner has a handle", () => {
    expect(signedInAs(undefined)).toBe("Signed in");
  });
});
