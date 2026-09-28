import { describe, expect, it } from "vitest";

import {
  entryPhotoIdOf,
  entryPhotoKeyFor,
  entryPhotoPrefix,
} from "../../src/lib/entry-photo-key";

describe("the entry photo key convention", () => {
  it("puts a photo under its runner and its entry", () => {
    expect(entryPhotoKeyFor("u1", "e1", "p1")).toBe("entries/u1/e1/p1");
  });

  it("gives an entry's prefix with its trailing slash, so e1 never matches e10", () => {
    expect(entryPhotoPrefix("u1", "e1")).toBe("entries/u1/e1/");
  });

  it("gives the runner's whole prefix when no entry is named", () => {
    expect(entryPhotoPrefix("u1")).toBe("entries/u1/");
  });

  it("reads the photo id back off the end of a key", () => {
    expect(entryPhotoIdOf(entryPhotoKeyFor("u1", "e1", "p1"))).toBe("p1");
    // A key with no slash is its own id; nothing before it is read.
    expect(entryPhotoIdOf("p2")).toBe("p2");
  });
});
