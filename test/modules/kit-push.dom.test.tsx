import { readFileSync } from "node:fs";

import { act, renderHook } from "@testing-library/react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DESK_MEDIA_QUERY,
  attachSearch,
  isAtDesk,
  useIsAtDesk,
  verdictSearch,
} from "../../src/modules/feed/kit-push";
import { atWidth } from "./feed-fixtures";

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

describe("verdictSearch", () => {
  it("reads A3b's push from the URL", () => {
    expect(verdictSearch.parse({ specifics: true })).toEqual({
      specifics: true,
    });
  });

  it("reads anything else as no push, rather than refusing the page", () => {
    expect(verdictSearch.parse({ specifics: "yes" })).toEqual({});
    expect(verdictSearch.parse({})).toEqual({});
  });
});

function Probe() {
  // The value itself, so a server answer that is merely falsy is told
  // apart from `false`.
  return String(useIsAtDesk());
}

describe("useIsAtDesk", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("follows the window across the breakpoint", () => {
    const width = atWidth(true);
    const { result } = renderHook(() => useIsAtDesk());
    expect(result.current).toBe(true);
    act(() => {
      width.resize(false);
    });
    expect(result.current).toBe(false);
  });

  it("stops listening once nothing reads it", () => {
    const query = {
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("matchMedia", (asked: string) =>
      asked === DESK_MEDIA_QUERY ? query : undefined,
    );
    const { unmount } = renderHook(() => useIsAtDesk());
    const [[type, listener]] = query.addEventListener.mock.calls as [
      [string, () => void],
    ];
    expect(type).toBe("change");
    unmount();
    expect(query.removeEventListener).toHaveBeenCalledWith("change", listener);
  });

  it("is below the desk on the server, which has no window", () => {
    // A window at the desk is not consulted: the server draws the sheet.
    atWidth(true);
    expect(renderToString(createElement(Probe))).toBe("false");
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
