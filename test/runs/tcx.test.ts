import { describe, expect, it } from "vitest";

import type { RunDraft } from "../../src/lib/contracts";
import { tcxSource } from "../../src/modules/runs/parsers/tcx";
import {
  PARSE_FAILURE_MESSAGE,
  RunParseError,
} from "../../src/modules/runs/parsers/shared";

/**
 * Every way a TCX file can be wrong, and the one way it is different from
 * GPX: TCX carries lap totals independent of GPS, so a treadmill export is
 * a lap with real duration and distance and no `<Position>` anywhere. That
 * is the "no GPS track" signal the packet asks for, and getting it wrong
 * means an indoor run stored at whatever coordinates happened to be lying
 * around.
 */

const START = "2026-01-15T07:00:00Z";

function bytesOf(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

function parse(text: string): Promise<RunDraft> {
  return tcxSource.parse(bytesOf(text));
}

async function failureFrom(text: string): Promise<RunParseError> {
  try {
    await parse(text);
  } catch (error) {
    if (error instanceof RunParseError) return error;
    throw error;
  }
  throw new Error("expected the parse to fail");
}

async function reasonFor(text: string): Promise<string> {
  const failure = await failureFrom(text);
  expect(failure.message).toBe(PARSE_FAILURE_MESSAGE);
  return failure.reason;
}

/**
A TCX document wrapping the given `<Lap>` body.
*/
function tcxWith(laps: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase><Activities><Activity Sport="Running">${laps}</Activity></Activities></TrainingCenterDatabase>`;
}

function lap(options: {
  startTime?: string;
  seconds?: number | string;
  metres?: number | string;
  track?: string;
}): string {
  const attributes =
    options.startTime === undefined ? "" : ` StartTime="${options.startTime}"`;
  const seconds =
    options.seconds === undefined
      ? ""
      : `<TotalTimeSeconds>${String(options.seconds)}</TotalTimeSeconds>`;
  const metres =
    options.metres === undefined
      ? ""
      : `<DistanceMeters>${String(options.metres)}</DistanceMeters>`;
  return `<Lap${attributes}>${seconds}${metres}${options.track ?? ""}</Lap>`;
}

function trackpoint(lat?: number, lon?: number): string {
  if (lat === undefined || lon === undefined) return "<Trackpoint></Trackpoint>";
  return `<Trackpoint><Position><LatitudeDegrees>${String(lat)}</LatitudeDegrees><LongitudeDegrees>${String(lon)}</LongitudeDegrees></Position></Trackpoint>`;
}

const OUTDOOR_LAP = {
  startTime: START,
  seconds: 1800,
  metres: 5000,
  track: `<Track>${trackpoint(44.98, -93.27)}</Track>`,
};

describe("tcx: a well-formed lap", () => {
  it("reads the totals off the lap, not off the trackpoints", async () => {
    const draft = await parse(tcxWith(lap(OUTDOOR_LAP)));

    expect(draft.startedAt).toBe(Math.floor(Date.parse(START) / 1000));
    expect(draft.durationS).toBe(1800);
    expect(draft.distanceM).toBe(5000);
    expect(draft.lat).toBeCloseTo(44.98, 6);
    expect(draft.lng).toBeCloseTo(-93.27, 6);
    expect(draft.indoor).toBe(false);
  });

  it("rounds a fractional duration to whole seconds", async () => {
    const draft = await parse(
      tcxWith(lap({ ...OUTDOOR_LAP, seconds: "1800.6" })),
    );
    expect(draft.durationS).toBe(1801);
  });

  it("takes the first position it finds, across tracks and points", async () => {
    // A watch writes a lead-in of positionless points while it acquires a
    // fix; the run started where the first fix was.
    const track =
      `<Track>${trackpoint()}</Track>` +
      `<Track>${trackpoint()}${trackpoint(45.5, -93.5)}${trackpoint(44.98, -93.27)}</Track>`;
    const draft = await parse(tcxWith(lap({ ...OUTDOOR_LAP, track })));

    expect(draft.lat).toBeCloseTo(45.5, 6);
    expect(draft.lng).toBeCloseTo(-93.5, 6);
  });

  it("takes only the first lap of the first activity", async () => {
    // v1 imports one run. A second lap or a second activity is a longer
    // file, not a second run.
    const draft = await parse(
      tcxWith(lap(OUTDOOR_LAP) + lap({ ...OUTDOOR_LAP, metres: 99_999 })),
    );
    expect(draft.distanceM).toBe(5000);
  });
});

describe("tcx: the treadmill case", () => {
  it("imports a lap with no position at all as indoor", async () => {
    // Real duration and distance from the lap totals, no coordinates, no
    // separate code path.
    const track = `<Track>${trackpoint()}${trackpoint()}</Track>`;
    const draft = await parse(
      tcxWith(lap({ startTime: START, seconds: 1800, metres: 5000, track })),
    );

    expect(draft.indoor).toBe(true);
    expect(draft.distanceM).toBe(5000);
    expect(draft.lat).toBeUndefined();
    expect(draft.lng).toBeUndefined();
  });

  it("imports a lap with no track element as indoor", async () => {
    const draft = await parse(
      tcxWith(lap({ startTime: START, seconds: 1800, metres: 5000 })),
    );
    expect(draft.indoor).toBe(true);
  });

  it("treats a half-written position as no position, either half", async () => {
    // A latitude with no longitude places a run on a meridian; a longitude
    // with no latitude places it on the equator. Neither is where it
    // happened.
    const latOnly =
      "<Track><Trackpoint><Position><LatitudeDegrees>44.98</LatitudeDegrees></Position></Trackpoint></Track>";
    const lonOnly =
      "<Track><Trackpoint><Position><LongitudeDegrees>-93.27</LongitudeDegrees></Position></Trackpoint></Track>";

    for (const track of [latOnly, lonOnly]) {
      const draft = await parse(
        tcxWith(lap({ startTime: START, seconds: 1800, metres: 5000, track })),
      );
      expect(draft.indoor, track).toBe(true);
      expect(draft.lat).toBeUndefined();
      expect(draft.lng).toBeUndefined();
    }
  });

  it("ignores a track that is not an element", async () => {
    const draft = await parse(
      tcxWith(
        lap({
          startTime: START,
          seconds: 1800,
          metres: 5000,
          track: "<Track>plain text</Track>",
        }),
      ),
    );
    expect(draft.indoor).toBe(true);
  });
});

describe("tcx: every way it refuses", () => {
  it("says when there is no lap to read", async () => {
    const documents = [
      "<?xml version=\"1.0\"?><other/>",
      "<?xml version=\"1.0\"?><TrainingCenterDatabase/>",
      "<?xml version=\"1.0\"?><TrainingCenterDatabase><Activities/></TrainingCenterDatabase>",
      "<?xml version=\"1.0\"?><TrainingCenterDatabase><Activities><Activity/></Activities></TrainingCenterDatabase>",
      "<?xml version=\"1.0\"?><TrainingCenterDatabase>text</TrainingCenterDatabase>",
      "<?xml version=\"1.0\"?><TrainingCenterDatabase><Activities>text</Activities></TrainingCenterDatabase>",
    ];

    for (const document of documents) {
      expect(await reasonFor(document), document).toContain("no Lap element");
    }
  });

  it("says when the lap has no usable totals", async () => {
    const missing = [
      lap({ seconds: 1800, metres: 5000 }),
      lap({ startTime: START, metres: 5000 }),
      lap({ startTime: START, seconds: 1800 }),
      lap({ startTime: START, seconds: 0, metres: 5000 }),
      lap({ startTime: START, seconds: 1800, metres: 0 }),
      lap({ startTime: START, seconds: -60, metres: 5000 }),
      lap({ startTime: "not a date", seconds: 1800, metres: 5000 }),
      lap({ startTime: START, seconds: "soon", metres: 5000 }),
    ];

    for (const body of missing) {
      expect(await reasonFor(tcxWith(body)), body).toContain(
        "missing positive TotalTimeSeconds/DistanceMeters",
      );
    }
  });

  it("says when the assembled run is not one the contract accepts", async () => {
    const track = `<Track>${trackpoint(91, -93.27)}</Track>`;
    const failure = await failureFrom(tcxWith(lap({ ...OUTDOOR_LAP, track })));

    expect(failure.reason).toContain("runDraftSchema");
    expect(failure.cause).toBeDefined();
  });

  it("says when the bytes are not valid text", async () => {
    const notText = new Uint8Array([0xff, 0xfe, 0x00, 0x00]).buffer;
    await expect(tcxSource.parse(notText)).rejects.toThrow(
      PARSE_FAILURE_MESSAGE,
    );
  });

  it("names the format in the reason, not just the failure", async () => {
    // GPX and TCX share the decode step; the reason is how a maintainer
    // tells which file class is failing.
    const failure = await failureFrom("<?xml version=\"1.0\"?><other/>");
    expect(failure.reason.startsWith("tcx:")).toBe(true);

    // Including the shared decode step, which takes the format as an
    // argument — the one place the two parsers could report each other's.
    const rejected = `<?xml version="1.0"?>
<!DOCTYPE x [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<TrainingCenterDatabase/>`;
    const shared = await failureFrom(rejected);
    expect(shared.reason.startsWith("tcx:")).toBe(true);
  });
});
