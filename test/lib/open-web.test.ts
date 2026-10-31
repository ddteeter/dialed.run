import { describe, expect, it, vi } from "vitest";

import { isOpenWebPath, signedInOffTheOpenWeb } from "../../src/lib/open-web";

/**
 * The open web's paths (design 163, D-153): where the root reads no
 * session, so a public page is the same for every viewer.
 */

describe("isOpenWebPath", () => {
  it.each(["/kit/01J00000000000000000000000", "/kit/anything/", "/kit/x"])(
    "is %s, a public kit",
    (path) => {
      expect(isOpenWebPath(path)).toBe(true);
    },
  );

  it.each(["/@maya_runs", "/@maya_runs/", "/%40maya_runs", "/%40Maya"])(
    "is %s, a public profile",
    (path) => {
      expect(isOpenWebPath(path)).toBe(true);
    },
  );

  it.each([
    "/",
    "/@",
    "/@/",
    "/@maya/kits",
    "/x/@maya",
    "/feed/u/maya_runs",
    "/k",
    "/kit",
    "/kit/",
    "/kit/a/b",
    "/feed/entry/01J00000000000000000000000",
    "/x/kit/01J00000000000000000000000",
    "/k/01J00000000000000000000000",
    "/kits/01J00000000000000000000000",
  ])("is not %s", (path) => {
    expect(isOpenWebPath(path)).toBe(false);
  });
});

describe("signedInOffTheOpenWeb", () => {
  it("answers nobody on a public page, without asking", async () => {
    const ask = vi.fn(() => Promise.resolve({ signedIn: true }));

    expect(await signedInOffTheOpenWeb("/kit/x", ask)).toStrictEqual({
      signedIn: false,
    });
    expect(ask).not.toHaveBeenCalled();
  });

  it("asks the session anywhere else", async () => {
    const ask = vi.fn(() => Promise.resolve({ signedIn: true }));

    expect(await signedInOffTheOpenWeb("/feed", ask)).toStrictEqual({
      signedIn: true,
    });
    expect(ask).toHaveBeenCalledTimes(1);
  });
});
