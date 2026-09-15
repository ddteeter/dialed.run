import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  setBlurPreference,
  shouldBlurFaces,
} from "../../src/modules/safety/blur/preference";

/**
 * `Storage`'s own API returns `null`, and `unicorn/no-null` forbids the
 * literal — so the one value the interface demands is parsed rather than
 * written. Same idiom as `test/modules/closet-fixtures.ts`.
 */
const NOTHING = z.null().parse(JSON.parse("null"));

/**
 * A `Storage` a test can drive, including the ways a real one misbehaves.
 * Private windows and blocked site data throw rather than returning null,
 * and that path decides whether someone's face gets blurred.
 */
function boom(): never {
  throw new Error("storage is blocked");
}

function fakeStorage(options: { throws?: boolean } = {}): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => {
      values.clear();
    },
    // Part of the Storage interface and called by nothing here; the
    // preference module reads and writes by key only.
    key: () => NOTHING,
    getItem: (key: string) =>
      options.throws === true ? boom() : (values.get(key) ?? NOTHING),
    setItem: (key: string, value: string) => {
      if (options.throws === true) boom();
      values.set(key, value);
    },
    removeItem: (key: string) => {
      if (options.throws === true) boom();
      values.delete(key);
    },
  };
}

describe("the default", () => {
  it("is on, with nothing stored", () => {
    // W3 is "ON BY DEFAULT", and a privacy default that must be switched
    // on is one most people never switch on.
    expect(shouldBlurFaces(fakeStorage())).toBe(true);
  });

  it("writes nothing when blur is left on", () => {
    const storage = fakeStorage();
    setBlurPreference(true, storage);
    // The default is expressed by absence. Storing it would mean writing
    // to every runner's browser to record that nothing unusual happened.
    expect(storage).toHaveLength(0);
  });
});

describe("a refusal", () => {
  it("is remembered, because it is what saves the download", () => {
    const storage = fakeStorage();
    setBlurPreference(false, storage);
    expect(shouldBlurFaces(storage)).toBe(false);
  });

  it("can be taken back", () => {
    const storage = fakeStorage();
    setBlurPreference(false, storage);
    setBlurPreference(true, storage);

    expect(shouldBlurFaces(storage)).toBe(true);
    // Back to absence, not to a second stored value meaning the same
    // thing as no value.
    expect(storage).toHaveLength(0);
  });
});

describe("when storage misbehaves", () => {
  it("reads as on when getItem throws", () => {
    // Private windows and blocked site data throw. The safe direction is
    // unambiguous: failing to read a preference must never silently stop
    // blurring someone's face.
    expect(shouldBlurFaces(fakeStorage({ throws: true }))).toBe(true);
  });

  it("does not throw out of a photo picker when writing fails", () => {
    const storage = fakeStorage({ throws: true });
    expect(() => {
      setBlurPreference(false, storage);
    }).not.toThrow();
  });

  it("reads as on when there is no storage at all", () => {
    // Also the server: this module is reachable from a route, and SSR has
    // no localStorage.
    expect(shouldBlurFaces()).toBe(true);
  });
});
