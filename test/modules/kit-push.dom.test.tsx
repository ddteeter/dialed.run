import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DESK_MEDIA_QUERY,
  attachSearch,
  isAtDesk,
} from "../../src/modules/feed/kit-push";

/**
 * A2b's push at the desk (Round 54 · 164.3): the category it pushed to
 * rides in A2's URL, and the width it pushes from is the theme's desk.
 */
describe("attachSearch", () => {
  it("reads a category from the URL", () => {
    expect(attachSearch.parse({ pick: "tops" })).toEqual({ pick: "tops" });
  });

  it("reads anything else as no push, rather than refusing the page", () => {
    expect(attachSearch.parse({ pick: "socks-and-sandals" })).toEqual({});
    expect(attachSearch.parse({})).toEqual({});
  });
});

describe("the desk breakpoint", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is the theme's own, not a second copy of it", () => {
    // From the project root, where vitest runs: this file's own URL is
    // happy-dom's here, not a file URL.
    const css = readFileSync("src/styles.css", "utf8");
    const desk = /--breakpoint-desk:\s*(\d+px);/u.exec(css)?.[1];
    expect(DESK_MEDIA_QUERY).toBe(`(min-width: ${String(desk)})`);
  });

  it("asks the window at the desk query, now", () => {
    const matchMedia = vi.fn((query: string) => ({
      matches: query === DESK_MEDIA_QUERY,
    }));
    vi.stubGlobal("matchMedia", matchMedia);
    expect(isAtDesk()).toBe(true);
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    expect(isAtDesk()).toBe(false);
  });
});
