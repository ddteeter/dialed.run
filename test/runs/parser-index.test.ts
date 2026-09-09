import { describe, expect, it } from "vitest";

import {
  extensionFromKey,
  importExtensionOf,
  sourceFor,
  IMPORT_EXTENSIONS,
} from "../../src/modules/runs/parsers";
import { RunParseError } from "../../src/modules/runs/parsers/shared";

/**
 * Which parser reads which file.
 *
 * The rule lives here once: an upload rejects with copy the user reads,
 * and an unreadable R2 key is an internal parse failure. The rule behind
 * both was what used to be copied — and none of it was tested, so the
 * extension pattern could match anywhere in a path and every miss could
 * be silently allowed through.
 */

describe("importExtensionOf", () => {
  it("recognises each format the app imports", () => {
    for (const extension of IMPORT_EXTENSIONS) {
      expect(importExtensionOf(`run.${extension}`), extension).toBe(extension);
    }
  });

  it("reads the extension case-insensitively", () => {
    // Watches export `.FIT` as often as `.fit`.
    expect(importExtensionOf("RUN.FIT")).toBe("fit");
    expect(importExtensionOf("Morning.Gpx")).toBe("gpx");
  });

  it("reads only the last extension, and only at the end", () => {
    // Anchored: `run.fit.txt` is a text file, and matching anywhere would
    // hand it to the FIT decoder.
    expect(importExtensionOf("run.fit.txt")).toBeUndefined();
    expect(importExtensionOf("imports/2026/run.gpx")).toBe("gpx");
    expect(importExtensionOf("archive.tcx.zip")).toBeUndefined();
  });

  it("refuses a format it cannot read", () => {
    expect(importExtensionOf("run.csv")).toBeUndefined();
    expect(importExtensionOf("photo.jpg")).toBeUndefined();
  });

  it("refuses a path with no extension at all", () => {
    expect(importExtensionOf("run")).toBeUndefined();
    expect(importExtensionOf("")).toBeUndefined();
    expect(importExtensionOf("imports/2026/")).toBeUndefined();
  });
});

describe("extensionFromKey", () => {
  it("reads the extension out of a stored key", () => {
    expect(extensionFromKey("imports/user/run.tcx")).toBe("tcx");
  });

  it("names the key it could not read", () => {
    // An unknown extension never reaches the queue — it is rejected at
    // upload — so reaching this means the stored key is corrupt, and the
    // key is the only way to find which one.
    let thrown: RunParseError | undefined;
    try {
      extensionFromKey("imports/user/run.csv");
    } catch (error) {
      if (error instanceof RunParseError) thrown = error;
    }
    expect(thrown).toBeInstanceOf(RunParseError);
    expect(thrown?.reason).toContain("imports/user/run.csv");
  });
});

describe("sourceFor", () => {
  it("gives each extension a parser that knows its own kind", () => {
    for (const extension of IMPORT_EXTENSIONS) {
      expect(sourceFor(extension).kind, extension).toBe(extension);
    }
  });
});
