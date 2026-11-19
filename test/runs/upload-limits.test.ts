import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  IMPORT_BYTE_CAPS,
  IMPORT_EXTENSIONS,
  MAX_IMPORT_BYTES,
  NO_TRACK_MESSAGE,
  PARSE_FAILURE_MESSAGE,
  UPLOAD_REFUSALS,
  UPLOADS_PER_DAY,
  checkUpload,
  parseFailureSentence,
} from "../../src/modules/runs/upload-limits";

/**
 * A1's refusals and parse sentences (round 22, "A1 Parse failed"): *"no
 * track → 'MORNING_RUN.GPX has no track in it. Export the run again.';
 * wrong type → 'That's not a GPX, TCX or FIT file.'; unreadable → 'We
 * couldn't read this file. Export it again.'"*
 */

describe("checkUpload", () => {
  it("passes a readable file, with the extension it will be parsed as", () => {
    expect(checkUpload({ name: "Morning.GPX", size: 10 })).toStrictEqual({
      ok: true,
      extension: "gpx",
    });
  });

  it("refuses another type first, whatever its size", () => {
    expect(checkUpload({ name: "run.csv", size: 0 })).toStrictEqual({
      ok: false,
      problem: "That's not a GPX, TCX or FIT file.",
    });
  });

  it("refuses an empty file, and takes one of a single byte", () => {
    expect(checkUpload({ name: "run.fit", size: 0 })).toStrictEqual({
      ok: false,
      problem: "That file is empty.",
    });
    expect(checkUpload({ name: "run.fit", size: 1 }).ok).toBe(true);
  });

  it.each(IMPORT_EXTENSIONS)(
    "takes a .%s file of exactly its format's cap, and refuses one byte over it",
    (extension) => {
      const name = `run.${extension}`;
      const cap = IMPORT_BYTE_CAPS[extension];
      expect(checkUpload({ name, size: cap })).toStrictEqual({
        ok: true,
        extension,
      });
      expect(checkUpload({ name, size: cap + 1 })).toStrictEqual({
        ok: false,
        problem: UPLOAD_REFUSALS.tooLarge[extension],
      });
    },
  );

  it("caps each format on its own (SA-L23; the owner, 2026-11-18)", () => {
    expect(IMPORT_BYTE_CAPS).toStrictEqual({
      fit: 10 * 1024 * 1024,
      gpx: 25 * 1024 * 1024,
      tcx: 25 * 1024 * 1024,
    });
  });

  it("holds a request to the largest of them before its format is read", () => {
    expect(MAX_IMPORT_BYTES).toBe(25 * 1024 * 1024);
    expect(MAX_IMPORT_BYTES).toBe(Math.max(...Object.values(IMPORT_BYTE_CAPS)));
  });

  it("names the format and its cap, and tells a text file's runner to export a FIT", () => {
    expect(UPLOAD_REFUSALS.tooLarge).toStrictEqual({
      fit: "That FIT file is larger than 10 MB.",
      gpx: "That GPX file is larger than 25 MB. Export the run as a FIT file instead.",
      tcx: "That TCX file is larger than 25 MB. Export the run as a FIT file instead.",
    });
  });

  it.each(IMPORT_EXTENSIONS)(
    "says the .%s cap the table holds, in megabytes",
    (extension) => {
      // The sentences are literals (a template costs the entry chunk), so
      // this is what keeps each number the table's.
      const megabytes = IMPORT_BYTE_CAPS[extension] / (1024 * 1024);
      expect(UPLOAD_REFUSALS.tooLarge[extension]).toContain(
        `That ${extension.toUpperCase()} file is larger than ${String(megabytes)} MB.`,
      );
    },
  );

  it("says a day's uploads are used up in the owner's words (SA-M29)", () => {
    expect(UPLOADS_PER_DAY).toBe(30);
    expect(UPLOAD_REFUSALS.tooMany).toContain(
      `That's ${String(UPLOADS_PER_DAY)} run files`,
    );
    expect(UPLOAD_REFUSALS.tooMany).toBe(
      "That's 30 run files today. You can upload more tomorrow.",
    );
  });
});

describe("the parse sentences", () => {
  it("are round 22's words", () => {
    expect(PARSE_FAILURE_MESSAGE).toBe(
      "We couldn't read this file. Export it again.",
    );
    expect(NO_TRACK_MESSAGE).toBe(
      "This file has no track in it. Export the run again.",
    );
  });
});

describe("parseFailureSentence", () => {
  it("names the file when it had no track in it", () => {
    expect(parseFailureSentence(NO_TRACK_MESSAGE, "MORNING_RUN.GPX")).toBe(
      "MORNING_RUN.GPX has no track in it. Export the run again.",
    );
  });

  it("passes any other recorded reason through as it is", () => {
    expect(parseFailureSentence(PARSE_FAILURE_MESSAGE, "run.fit")).toBe(
      PARSE_FAILURE_MESSAGE,
    );
  });

  it("calls a failure with no reason unreadable", () => {
    // SQL NULL, as the column holds a failure with no reason.
    const noReason = z.null().parse(JSON.parse("null"));
    expect(parseFailureSentence(noReason, "run.fit")).toBe(
      PARSE_FAILURE_MESSAGE,
    );
  });
});
