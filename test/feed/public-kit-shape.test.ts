import { describe, expect, it } from "vitest";

import { isNotFound } from "@tanstack/react-router";

import {
  kitOrNotFound,
  publicKitCardPath,
  publicKitHead,
  publicKitTitle,
  type PublicKit,
} from "../../src/modules/feed/public-kit-shape";

/**
 * The public kit's head (round 41 #86c, #86f).
 */

/**
A kit with none of the optional fields; `KIT` adds them.
*/
const BARE: PublicKit = {
  entryId: "01J00000000000000000000000",
  handle: "maya_runs",
  day: "Sat Oct 18",
  distance: { value: "6.2", unit: "mi" },
  time: { value: "52:10", isMoving: true },
  pieces: [],
  cardVersion: "0123456789abcdef",
};
const CONDITIONS = { feelsLike: "38°", sky: "damp", isProviders: true };

const KIT: PublicKit = {
  ...BARE,
  conditions: CONDITIONS,
  verdict: -1,
  caption: "First frosty one.",
};

describe("publicKitTitle", () => {
  it("is round 41's og:title, in the app's own verdict words", () => {
    expect(publicKitTitle(KIT)).toBe("@maya_runs · 38° damp, a bit cold");
  });

  it("drops whichever half the kit does not have", () => {
    expect(publicKitTitle({ ...BARE, verdict: -1 })).toBe(
      "@maya_runs · a bit cold",
    );
    expect(publicKitTitle({ ...BARE, conditions: CONDITIONS })).toBe(
      "@maya_runs · 38° damp",
    );
    expect(publicKitTitle(BARE)).toBe("@maya_runs");
  });
});

describe("publicKitCardPath", () => {
  it("carries the card's version, so an edit is a new URL", () => {
    expect(publicKitCardPath(KIT)).toBe(
      "/og/k/01J00000000000000000000000?v=0123456789abcdef",
    );
  });
});

describe("publicKitHead", () => {
  it("is noindex, titled, and previews as the kit's own card", () => {
    expect(publicKitHead(KIT, "https://dialed.run")).toStrictEqual({
      meta: [
        { name: "robots", content: "noindex" },
        { title: "@maya_runs · 38° damp, a bit cold" },
        { property: "og:title", content: "@maya_runs · 38° damp, a bit cold" },
        { property: "og:description", content: "First frosty one." },
        {
          property: "og:image",
          content:
            "https://dialed.run/og/k/01J00000000000000000000000?v=0123456789abcdef",
        },
      ],
    });
  });

  it("carries no description beyond the caption's first 120 characters", () => {
    const long = "x".repeat(130);
    const head = publicKitHead({ ...KIT, caption: long }, "https://o");

    expect(head.meta).toContainEqual({
      property: "og:description",
      content: "x".repeat(120),
    });
  });

  it("carries no description at all without a caption", () => {
    const head = publicKitHead(BARE, "https://o");

    expect(
      head.meta.some(
        (meta) => "property" in meta && meta.property === "og:description",
      ),
    ).toBe(false);
  });

  it("is noindex and nothing else when the kit is not public, so it keeps the default card", () => {
    expect(publicKitHead(undefined, "https://dialed.run")).toStrictEqual({
      meta: [{ name: "robots", content: "noindex" }],
    });
  });
});

describe("kitOrNotFound", () => {
  it("hands a public kit through", () => {
    expect(kitOrNotFound(KIT)).toBe(KIT);
  });

  it("is the router's 404 for anything else, one answer for every reason", () => {
    let thrown: unknown;
    try {
      kitOrNotFound(undefined);
    } catch (error: unknown) {
      thrown = error;
    }
    expect(isNotFound(thrown)).toBe(true);
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).toMatchObject({ message: "not a public kit" });
  });
});
