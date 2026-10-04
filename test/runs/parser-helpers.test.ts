import { describe, expect, it } from "vitest";

import {
  child,
  elevationGainMeters,
  fileMetrics,
  haversineMeters,
  present,
  isRecord,
  PARSE_FAILURE_MESSAGE,
  readDate,
  readNumber,
  RunParseError,
  toArray,
} from "../../src/modules/runs/parsers/shared";

/**
 * The plumbing every file parser is built on.
 *
 * GPX and TCX are XML parsed to `unknown` — a trust boundary — and these
 * four helpers are how every field crosses it. Twenty-one mutants lived in
 * them: the haversine's arithmetic could be rearranged into any shape, and
 * every narrowing guard could be widened, with the parser tests still
 * green because they only ever fed well-formed files.
 */

describe("RunParseError", () => {
  it("says the same thing to every user, whatever went wrong", () => {
    // The user-facing copy never varies; the queue consumer writes it
    // verbatim onto the import row.
    expect(new RunParseError("gpx: no trkpt").message).toBe(
      PARSE_FAILURE_MESSAGE,
    );
    expect(new RunParseError("tcx: no laps").message).toBe(
      PARSE_FAILURE_MESSAGE,
    );
  });

  it("keeps the maintainer-facing reason apart from it", () => {
    // Nineteen sites used to throw the same argument-less error, so Sentry
    // recorded one message nineteen ways with nothing to tell them apart.
    const error = new RunParseError("fit: unsupported protocol version");
    expect(error.reason).toBe("fit: unsupported protocol version");
    expect(error.name).toBe("RunParseError");
    expect(error).toBeInstanceOf(Error);
  });

  it("carries the underlying failure where there was one", () => {
    const cause = new Error("unexpected end of input");
    expect(new RunParseError("gpx: xml", { cause }).cause).toBe(cause);
  });
});

describe("toArray", () => {
  it("treats a missing element as no elements", () => {
    // XML gives one object for a single element and an array for several;
    // absent is neither, and must not become `[undefined]`.
    expect(toArray(undefined)).toStrictEqual([]);
  });

  it("wraps a single element and passes a list through", () => {
    expect(toArray("one")).toStrictEqual(["one"]);
    expect(toArray(["one", "two"])).toStrictEqual(["one", "two"]);
  });

  it("keeps an empty list empty", () => {
    expect(toArray([])).toStrictEqual([]);
  });
});

describe("isRecord", () => {
  it("admits an object and refuses null", () => {
    // `typeof null` is "object", which is the whole reason this exists.
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord(readDate(1))).toBe(false);
  });

  it("refuses the primitives an XML parser hands back", () => {
    expect(isRecord("text")).toBe(false);
    expect(isRecord(42)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
  });
});

describe("readNumber", () => {
  it("takes a number as it is", () => {
    expect(readNumber(42)).toBe(42);
    expect(readNumber(0)).toBe(0);
    expect(readNumber(-1.5)).toBe(-1.5);
  });

  it("parses a numeric string", () => {
    // TCX and GPX give every value as text.
    expect(readNumber("42")).toBe(42);
    expect(readNumber(" -1.5 ")).toBe(-1.5);
  });

  it("refuses a blank string rather than reading it as zero", () => {
    // `Number("")` is 0, and an empty distance element that parses as
    // zero is a run recorded as zero metres.
    expect(readNumber("")).toBeUndefined();
    expect(readNumber(" ".repeat(3))).toBeUndefined();
  });

  it("refuses text that is not a number", () => {
    expect(readNumber("about 5k")).toBeUndefined();
    expect(readNumber("Infinity")).toBeUndefined();
    expect(readNumber("NaN")).toBeUndefined();
  });

  it("refuses anything that is neither", () => {
    expect(readNumber({ value: 1 })).toBeUndefined();
    expect(readNumber(undefined)).toBeUndefined();
  });
});

describe("readDate", () => {
  it("parses an ISO timestamp", () => {
    expect(readDate("2026-01-15T07:00:00Z")?.toISOString()).toBe(
      "2026-01-15T07:00:00.000Z",
    );
  });

  it("refuses a string that is not a date", () => {
    expect(readDate("sometime last week")).toBeUndefined();
  });

  it("refuses anything that is not a string", () => {
    // A number would parse as epoch milliseconds, which is not what any of
    // these formats mean by a timestamp.
    expect(readDate(1_768_485_600)).toBeUndefined();
    expect(readDate(undefined)).toBeUndefined();
  });
});

describe("haversineMeters", () => {
  it("is zero for a point and itself", () => {
    expect(haversineMeters(44.98, -93.27, 44.98, -93.27)).toBe(0);
  });

  it("measures a known distance", () => {
    // One degree of latitude is about 111.2 km anywhere on Earth. Every
    // rearrangement of this formula — a plus for a minus, a divide for a
    // multiply — moves this by kilometres.
    expect(haversineMeters(0, 0, 1, 0)).toBeCloseTo(111_195, -2);
    expect(haversineMeters(44, -93, 45, -93)).toBeCloseTo(111_195, -2);
  });

  it("shrinks a degree of longitude towards the poles", () => {
    // The `cos(lat)` factor. Without it a degree of longitude is the same
    // width everywhere, and a Minneapolis run measures like an equatorial
    // one.
    const atEquator = haversineMeters(0, 0, 0, 1);
    const atSixty = haversineMeters(60, 0, 60, 1);
    expect(atEquator).toBeCloseTo(111_195, -2);
    expect(atSixty).toBeCloseTo(atEquator / 2, -3);
  });

  it("is symmetric, and does not care about the sign of the delta", () => {
    expect(haversineMeters(44, -93, 45, -92)).toBeCloseTo(
      haversineMeters(45, -92, 44, -93),
      6,
    );
  });

  it("measures a short leg the way a GPS track is summed", () => {
    // The realistic case: a few metres between consecutive trackpoints.
    expect(haversineMeters(44.98, -93.27, 44.9801, -93.27)).toBeCloseTo(11, 0);
  });
});

describe("child", () => {
  it("reads a child off an element", () => {
    expect(child({ Time: "07:00" }, "Time")).toBe("07:00");
  });

  it("reads nothing off a value that is not an element", () => {
    // `<Track/>` parses to "", and a string has properties of its own —
    // a length — that are not children.
    expect(child("text", "length")).toBeUndefined();
    expect(child(undefined, "Time")).toBeUndefined();
  });
});

describe("present", () => {
  it("is a list of one for a reading, and empty for none", () => {
    expect(present(0)).toStrictEqual([0]);
    expect(present(undefined)).toStrictEqual([]);
  });
});

describe("elevationGainMeters (D-111)", () => {
  it("says nothing with fewer than two altitudes", () => {
    expect(elevationGainMeters([])).toBeUndefined();
    expect(elevationGainMeters([100])).toBeUndefined();
    expect(elevationGainMeters([100, 106])).toBe(6);
  });

  it("counts a turn only once it exceeds the threshold", () => {
    expect(elevationGainMeters([100, 105])).toBe(0);
    expect(elevationGainMeters([100, 105.5])).toBe(5.5);
  });

  it("makes the first rise clear the threshold like any other", () => {
    expect(elevationGainMeters([100, 103, 104])).toBe(0);
  });

  it("follows a descent freely, and counts a climb from its foot", () => {
    expect(elevationGainMeters([100, 90, 96])).toBe(6);
    // Once climbing, every metre counts, small ones included.
    expect(elevationGainMeters([100, 90, 96, 97])).toBe(7);
  });

  it("counts a started climb in full, and the wobble at its top once", () => {
    expect(elevationGainMeters([100, 106, 108, 107, 110])).toBe(10);
    expect(elevationGainMeters([100, 120, 117, 120, 117, 120])).toBe(20);
  });

  it("needs a real turn down before a rise counts again", () => {
    // Down 10 from the top is a turn; up 4 from there is not a climb.
    expect(elevationGainMeters([100, 120, 110, 114])).toBe(20);
    // Up 6 from the foot of that turn is.
    expect(elevationGainMeters([100, 120, 110, 114, 116])).toBe(26);
  });
});

describe("fileMetrics (D-111)", () => {
  it("carries neither reading for an indoor run", () => {
    expect(fileMetrics(true, 1800, 40)).toStrictEqual({});
  });

  it("rounds moving time to whole seconds and passes the climb through", () => {
    expect(fileMetrics(false, 1800.5, 40.25)).toStrictEqual({
      movingS: 1801,
      elevationGainM: 40.25,
    });
  });

  it("leaves out a moving time that is missing or rounds to nothing", () => {
    expect(fileMetrics(false, undefined, undefined)).toStrictEqual({
      movingS: undefined,
      elevationGainM: undefined,
    });
    expect(fileMetrics(false, 0.4, 0).movingS).toBeUndefined();
    expect(fileMetrics(false, 0.5, 0).movingS).toBe(1);
  });
});
