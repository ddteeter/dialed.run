import { describe, expect, it } from "vitest";

import {
  importFileKeyFor,
  importFilePrefix,
} from "../../src/lib/import-file-key";

describe("the run file key convention", () => {
  it("puts an upload under its runner, named by its id and extension", () => {
    expect(importFileKeyFor("u1", "i1", "gpx")).toBe("imports/u1/i1.gpx");
  });

  it("gives the runner's prefix with its trailing slash, so u1 never matches u10", () => {
    expect(importFilePrefix("u1")).toBe("imports/u1/");
    expect(importFileKeyFor("u1", "i1", "fit").startsWith("imports/u1/")).toBe(
      true,
    );
  });
});
