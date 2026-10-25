import { describe, expect, it } from "vitest";

import {
  garminConfigFor,
  garminConfigFrom,
} from "../../src/modules/runs/garmin/config";

describe("garminConfigFrom", () => {
  it("is configured with both the key and its owner", () => {
    expect(garminConfigFrom("key", "owner")).toEqual({
      apiKey: "key",
      ownerUserId: "owner",
    });
  });

  it("points at a stub only when told to", () => {
    expect(garminConfigFrom("key", "owner", "https://stub.test")?.origin).toBe(
      "https://stub.test",
    );
    expect(garminConfigFrom("key", "owner", "")?.origin).toBeUndefined();
    expect(garminConfigFrom("key", "owner")?.origin).toBeUndefined();
  });

  it("trims what a secret put may carry", () => {
    expect(garminConfigFrom(" key\n", " owner ")).toEqual({
      apiKey: "key",
      ownerUserId: "owner",
    });
  });

  it.each([
    [undefined, "owner"],
    ["key", undefined],
    ["", "owner"],
    ["key", "  "],
    [undefined, undefined],
  ])("is not configured with key %j and owner %j", (key, owner) => {
    expect(garminConfigFrom(key, owner)).toBeUndefined();
  });
});

describe("garminConfigFor", () => {
  const config = { apiKey: "key", ownerUserId: "owner", origin: undefined };

  it("is the owner's", () => {
    expect(garminConfigFor(config, "owner")).toBe(config);
  });

  it("is nobody else's", () => {
    expect(garminConfigFor(config, "someone")).toBeUndefined();
  });

  it("is nobody's when unconfigured", () => {
    expect(garminConfigFor(undefined, "owner")).toBeUndefined();
  });
});
