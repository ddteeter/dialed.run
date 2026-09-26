import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  MAX_IMPORT_BYTES,
  NO_TRACK_MESSAGE,
  PARSE_FAILURE_MESSAGE,
  UPLOAD_REFUSALS,
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

  it("takes a file of exactly the cap, and refuses one byte over it", () => {
    expect(checkUpload({ name: "run.tcx", size: MAX_IMPORT_BYTES }).ok).toBe(
      true,
    );
    expect(
      checkUpload({ name: "run.tcx", size: MAX_IMPORT_BYTES + 1 }),
    ).toStrictEqual({ ok: false, problem: UPLOAD_REFUSALS.tooLarge });
    expect(UPLOAD_REFUSALS.tooLarge).toBe("That file is larger than 25 MB.");
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
