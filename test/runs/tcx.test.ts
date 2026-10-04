import { describe, expect, it } from "vitest";

import type { RunDraft } from "../../src/lib/contracts";
import { tcxSource } from "../../src/modules/runs/parsers/tcx";
import {
  NO_TRACK_MESSAGE,
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

/**
 * The runner's sentence a failure earns (round 22): a file that read and
 * held no lap, or no totals on it, has no track; anything else could not
 * be read.
 */
function sentenceFor(reason: string): string {
  return /no Lap element|tcx: lap \d+ of \d+ has no|lap\(s\) sum to zero/u.test(
    reason,
  )
    ? NO_TRACK_MESSAGE
    : PARSE_FAILURE_MESSAGE;
}

async function reasonFor(text: string): Promise<string> {
  const failure = await failureFrom(text);
  expect(failure.message).toBe(sentenceFor(failure.reason));
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
  if (lat === undefined || lon === undefined)
    return "<Trackpoint></Trackpoint>";
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
});

describe("tcx: a run of many laps", () => {
  // A Garmin export writes one <Lap> per auto-lap — often each mile — so a
  // run is the sum of its laps. Reading the first alone imported a 6-mile
  // run as its first mile (R-130).
  const LATER = "2026-01-15T07:10:00Z";

  it("sums every lap's totals and starts when the first lap did", async () => {
    const draft = await parse(
      tcxWith(
        lap(OUTDOOR_LAP) +
          lap({ startTime: LATER, seconds: 600, metres: 1609 }) +
          lap({ startTime: "2026-01-15T07:20:00Z", seconds: 300, metres: 800 }),
      ),
    );

    expect(draft.startedAt).toBe(Math.floor(Date.parse(START) / 1000));
    expect(draft.durationS).toBe(1800 + 600 + 300);
    expect(draft.distanceM).toBe(5000 + 1609 + 800);
  });

  it("rounds the summed duration once, not each lap", async () => {
    // 3 × 600.4 = 1801.2. Rounding each lap first would lose 1.2 seconds.
    const third = lap({ startTime: LATER, seconds: "600.4", metres: 1000 });
    const draft = await parse(tcxWith(third + third + third));
    expect(draft.durationS).toBe(1801);
  });

  it("needs a start time on the first lap only", async () => {
    const draft = await parse(
      tcxWith(lap(OUTDOOR_LAP) + lap({ seconds: 600, metres: 1609 })),
    );
    expect(draft.startedAt).toBe(Math.floor(Date.parse(START) / 1000));
    expect(draft.durationS).toBe(2400);

    // A later lap's start time does not stand in for a missing first one.
    const unstarted = tcxWith(
      lap({ seconds: 600, metres: 1609 }) + lap(OUTDOOR_LAP),
    );
    expect(await reasonFor(unstarted)).toBe(
      "tcx: lap 1 of 2 has no readable StartTime",
    );
  });

  it("counts a lap with a zero total as adding nothing", async () => {
    // A lap button pressed twice, or a lap spent stood at a crossing, is
    // a real lap with nothing in it; it does not make the file unreadable.
    const draft = await parse(
      tcxWith(
        lap(OUTDOOR_LAP) +
          lap({ startTime: LATER, seconds: 45, metres: 0 }) +
          lap({ startTime: LATER, seconds: 0, metres: 0 }),
      ),
    );
    expect(draft.durationS).toBe(1845);
    expect(draft.distanceM).toBe(5000);

    // Unless every lap is empty: then there is no run in the file at all.
    const empty = tcxWith(
      lap({ ...OUTDOOR_LAP, metres: 0 }) +
        lap({ startTime: LATER, seconds: 45, metres: 0 }),
    );
    expect(await reasonFor(empty)).toBe(
      "tcx: 2 lap(s) sum to zero TotalTimeSeconds or DistanceMeters",
    );
  });

  it("refuses the file when any lap has no usable total, rather than shortening the run", async () => {
    // Skipping the bad lap would import a run shorter than the one that
    // happened, and nobody would know. The file is refused, as a single
    // lap without totals always was.
    const broken = [
      lap({ startTime: LATER, metres: 1609 }),
      lap({ startTime: LATER, seconds: 600 }),
      lap({ startTime: LATER, seconds: -60, metres: 1609 }),
      lap({ startTime: LATER, seconds: 600, metres: -1 }),
      lap({ startTime: LATER, seconds: "soon", metres: 1609 }),
      "<Lap/>",
    ];

    for (const bad of broken) {
      const document = tcxWith(lap(OUTDOOR_LAP) + bad);
      expect(await reasonFor(document), bad).toBe(
        "tcx: lap 2 of 2 has no usable TotalTimeSeconds/DistanceMeters",
      );
    }
  });

  it("names the first bad lap, and how many laps there were", async () => {
    // The reason is a maintainer's only clue to which part of a long file
    // was wrong (RunParseError's doc), so it counts from one, as a watch
    // numbers its laps.
    const mile = lap({ startTime: LATER, seconds: 480, metres: 1609.34 });
    const bad = lap({ startTime: LATER, seconds: 480 });
    const sixLaps = tcxWith(
      [lap(OUTDOOR_LAP), mile, bad, mile, bad, mile].join(""),
    );

    expect(await reasonFor(sixLaps)).toBe(
      "tcx: lap 3 of 6 has no usable TotalTimeSeconds/DistanceMeters",
    );
    const firstBad = tcxWith(lap({ startTime: START, seconds: 480 }) + mile);
    expect(await reasonFor(firstBad)).toBe(
      "tcx: lap 1 of 2 has no usable TotalTimeSeconds/DistanceMeters",
    );
  });

  it("takes the first fix in any lap, not just the first", async () => {
    // A watch can still be acquiring through the whole of a short first
    // lap; that does not make the run indoor.
    const emptyTrack = `<Track>${trackpoint()}</Track>`;
    const withFixTrack = `<Track>${trackpoint(45.5, -93.5)}</Track>`;
    const draft = await parse(
      tcxWith(
        lap({
          startTime: START,
          seconds: 300,
          metres: 800,
          track: emptyTrack,
        }) +
          lap({
            startTime: LATER,
            seconds: 600,
            metres: 1609,
            track: withFixTrack,
          }) +
          lap(OUTDOOR_LAP),
      ),
    );

    expect(draft.indoor).toBe(false);
    expect(draft.lat).toBeCloseTo(45.5, 6);
    expect(draft.lng).toBeCloseTo(-93.5, 6);
  });

  it("reads only the first activity", async () => {
    // v1 imports one run. A second activity in the same file is out of
    // scope, not more laps of the first.
    const draft = await parse(`<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase><Activities>
<Activity Sport="Running">${lap(OUTDOOR_LAP)}</Activity>
<Activity Sport="Running">${lap({ ...OUTDOOR_LAP, metres: 99_999 })}${lap(OUTDOOR_LAP)}</Activity>
</Activities></TrainingCenterDatabase>`);
    expect(draft.durationS).toBe(1800);
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
      '<?xml version="1.0"?><other/>',
      '<?xml version="1.0"?><TrainingCenterDatabase/>',
      // A Garmin course file: the record root, and no Activities at all.
      '<?xml version="1.0"?><TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Courses/></TrainingCenterDatabase>',
      '<?xml version="1.0"?><TrainingCenterDatabase><Activities/></TrainingCenterDatabase>',
      '<?xml version="1.0"?><TrainingCenterDatabase><Activities><Activity/></Activities></TrainingCenterDatabase>',
      '<?xml version="1.0"?><TrainingCenterDatabase><Activities><Activity><Lap/></Activity></Activities></TrainingCenterDatabase>',
      '<?xml version="1.0"?><TrainingCenterDatabase>text</TrainingCenterDatabase>',
      '<?xml version="1.0"?><TrainingCenterDatabase><Activities>text</Activities></TrainingCenterDatabase>',
    ];

    for (const document of documents) {
      expect(await reasonFor(document), document).toContain("no Lap element");
    }
  });

  it("says when the lap has no start or no usable totals", async () => {
    const noStart = "tcx: lap 1 of 1 has no readable StartTime";
    const noTotal =
      "tcx: lap 1 of 1 has no usable TotalTimeSeconds/DistanceMeters";
    const zero = "tcx: 1 lap(s) sum to zero TotalTimeSeconds or DistanceMeters";
    const cases: [string, string][] = [
      [lap({ seconds: 1800, metres: 5000 }), noStart],
      [lap({ startTime: "not a date", seconds: 1800, metres: 5000 }), noStart],
      [lap({ startTime: START, metres: 5000 }), noTotal],
      [lap({ startTime: START, seconds: 1800 }), noTotal],
      [lap({ startTime: START, seconds: -60, metres: 5000 }), noTotal],
      [lap({ startTime: START, seconds: "soon", metres: 5000 }), noTotal],
      [lap({ startTime: START, seconds: 0, metres: 5000 }), zero],
      [lap({ startTime: START, seconds: 1800, metres: 0 }), zero],
    ];

    for (const [body, reason] of cases) {
      expect(await reasonFor(tcxWith(body)), body).toBe(reason);
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
    const failure = await failureFrom('<?xml version="1.0"?><other/>');
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
