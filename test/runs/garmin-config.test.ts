import { describe, expect, it } from "vitest";

import type { GarminVars } from "../../src/modules/runs/garmin/config";
import { garminConfigFor } from "../../src/modules/runs/garmin/config";

/**
The bindings as the Worker hands them: an unset secret is absent, not
undefined.
*/
function varsOf(
  key: string | undefined,
  owner: string | undefined,
  origin?: string,
): GarminVars {
  return {
    ...(key !== undefined && { GARMIN_API_KEY: key }),
    ...(owner !== undefined && { GARMIN_OWNER_USER_ID: owner }),
    ...(origin !== undefined && { GARMIN_API_ORIGIN: origin }),
  };
}

function originFor(origin: string | undefined): string | undefined {
  return garminConfigFor(varsOf("key", "owner", origin), "owner")?.origin;
}

describe("garminConfigFor", () => {
  it("is the owner's, with the key", () => {
    expect(garminConfigFor(varsOf("key", "owner"), "owner")).toEqual({
      apiKey: "key",
      ownerUserId: "owner",
      origin: undefined,
    });
  });

  it("is nobody else's", () => {
    expect(garminConfigFor(varsOf("key", "owner"), "someone")).toBeUndefined();
  });

  it("points at a stub only when told to", () => {
    expect(originFor("https://stub.test")).toBe("https://stub.test");
    expect(originFor(" https://stub.test\n")).toBe("https://stub.test");
    expect(originFor("")).toBeUndefined();
    expect(originFor(" ")).toBeUndefined();
    expect(originFor(undefined)).toBeUndefined();
  });

  it("trims what a secret put may carry", () => {
    expect(garminConfigFor(varsOf(" key\n", " owner "), "owner")).toEqual({
      apiKey: "key",
      ownerUserId: "owner",
      origin: undefined,
    });
  });

  it.each([
    [undefined, "owner"],
    ["key", undefined],
    ["", "owner"],
    ["key", "  "],
    [undefined, undefined],
  ])("is nobody's with key %j and owner %j", (key, owner) => {
    const vars = varsOf(key, owner);
    expect(garminConfigFor(vars, "owner")).toBeUndefined();
    // A blank owner never matches a blank id either.
    expect(garminConfigFor(vars, "")).toBeUndefined();
  });
});
