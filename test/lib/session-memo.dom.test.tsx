import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  forgetSession,
  isRememberedForSession,
  noteSessionOwner,
  rememberForSession,
} from "../../src/lib/browser/session-memo";

/**
 * The memo as a browser runs it: its owner in `localStorage`, which every
 * tab shares. The worker project has no `localStorage`, so only here is
 * the cross-tab half real. "Another tab" is a direct write to the store —
 * which is all another tab's copy of this module does.
 */

const OWNER_KEY = "dialed.run:session-owner";

beforeEach(() => {
  forgetSession();
  localStorage.clear();
});

describe("session memo, across tabs", () => {
  it("records its runner where every tab can read it", () => {
    rememberForSession("u1", "has-handle");
    expect(localStorage.getItem(OWNER_KEY)).toBe("u1");
    expect(isRememberedForSession("has-handle")).toBe(true);
    expect(isRememberedForSession("another-fact")).toBe(false);
  });

  it("stops answering once another tab signs somebody else in", () => {
    rememberForSession("u1", "has-handle");
    localStorage.setItem(OWNER_KEY, "u2");
    expect(isRememberedForSession("has-handle")).toBe(false);
  });

  it("stops answering once another tab signs out", () => {
    rememberForSession("u1", "has-handle");
    localStorage.removeItem(OWNER_KEY);
    expect(isRememberedForSession("has-handle")).toBe(false);
  });

  it("tells every other tab when this one signs in or out", () => {
    rememberForSession("u1", "has-handle");
    forgetSession();
    expect(localStorage.getItem(OWNER_KEY)).toBeNull();
    // …and forgets its own facts, not only the owner.
    noteSessionOwner("u1");
    expect(isRememberedForSession("has-handle")).toBe(false);
  });

  it("writes the owner the server names, and clears it for nobody", () => {
    noteSessionOwner("u3");
    expect(localStorage.getItem(OWNER_KEY)).toBe("u3");
    noteSessionOwner(undefined);
    expect(localStorage.getItem(OWNER_KEY)).toBeNull();
  });
});

/**
 * A store that refuses: `getItem` or `setItem` throwing, as a browser does
 * for blocked site data or a full quota. The real store behind a proxy
 * rather than a spy, because happy-dom's `localStorage` keeps an assigned
 * property as an item.
 */
function refusingStore(refuses: "getItem" | "setItem"): Storage {
  return new Proxy(localStorage, {
    get(target, property) {
      if (property === refuses) {
        return () => {
          throw new Error("SecurityError");
        };
      }
      const value: unknown = Reflect.get(target, property);
      if (typeof value !== "function") return value;
      const bound: unknown = value.bind(target);
      return bound;
    },
  });
}

describe("session memo, when the store refuses", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks again rather than throwing when a read is refused", () => {
    vi.stubGlobal("localStorage", refusingStore("getItem"));
    rememberForSession("u1", "has-handle");
    expect(isRememberedForSession("has-handle")).toBe(false);
  });

  it("does not throw when a write is refused, and remembers nothing it cannot key", () => {
    vi.stubGlobal("localStorage", refusingStore("setItem"));
    expect(() => {
      rememberForSession("u1", "has-handle");
    }).not.toThrow();
    expect(isRememberedForSession("has-handle")).toBe(false);
  });

  it("keeps the owner in the tab when the store itself cannot be reached", () => {
    const real = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => {
        throw new Error("SecurityError");
      },
    });
    try {
      rememberForSession("u1", "has-handle");
      expect(isRememberedForSession("has-handle")).toBe(true);
      noteSessionOwner("u2");
      expect(isRememberedForSession("has-handle")).toBe(false);
    } finally {
      if (real !== undefined) {
        Object.defineProperty(globalThis, "localStorage", real);
      }
    }
    // Nothing reached the shared store while it was blocked.
    expect(localStorage.getItem(OWNER_KEY)).toBeNull();
  });

  it("keeps the owner in the tab where there is no store at all", () => {
    const real = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Reflect.deleteProperty(globalThis, "localStorage");
    try {
      expect("localStorage" in globalThis).toBe(false);
      rememberForSession("u1", "has-handle");
      expect(isRememberedForSession("has-handle")).toBe(true);
    } finally {
      if (real !== undefined) {
        Object.defineProperty(globalThis, "localStorage", real);
      }
    }
    expect(localStorage.getItem(OWNER_KEY)).toBeNull();
  });
});
