import { describe, expect, it } from "vitest";

import type { RunDraft } from "../../src/lib/contracts";
import {
  PAUSE_GAP_S,
  STOPPED_SPEED_MPS,
  gpxSource,
} from "../../src/modules/runs/parsers/gpx";
import {
  ELEVATION_HYSTERESIS_M,
  NO_TRACK_MESSAGE,
  PARSE_FAILURE_MESSAGE,
  RunParseError,
} from "../../src/modules/runs/parsers/shared";
import pausedClimbGpx from "./fixtures/paused-climb.gpx?raw";

/**
 * Every way a GPX file can be wrong.
 *
 * `parsers.test.ts` walks one good file and one malformed one, which
 * leaves fifty mutants alive: every narrowing guard inside the trackpoint
 * walk could be widened, and each of the six failure reasons could be
 * blanked. The reasons are the maintainer-facing half — the user always
 * reads the same sentence — and blanking them puts the app back where it
 * was, with one message recorded nineteen ways.
 */

function bytesOf(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

/**
A GPX document wrapping the given `<trkseg>` body.
*/
function gpxWith(segments: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test"><trk><name>Test</name>${segments}</trk></gpx>`;
}

function point(lat: number, lon: number, time: string): string {
  return `<trkpt lat="${String(lat)}" lon="${String(lon)}"><time>${time}</time></trkpt>`;
}

const START = "2026-01-15T07:00:00Z";
const LATER = "2026-01-15T07:30:00Z";

/**
The parse failure's maintainer-facing reason.
*/
function parse(text: string): Promise<RunDraft> {
  return gpxSource.parse(bytesOf(text));
}

async function failureFrom(
  attempt: () => Promise<unknown>,
): Promise<RunParseError> {
  try {
    await attempt();
  } catch (error) {
    if (error instanceof RunParseError) return error;
    throw error;
  }
  throw new Error("expected the parse to fail");
}

/**
 * The runner's sentence a failure earns (round 22): a file that read and
 * held no track says so; anything else could not be read.
 */
function sentenceFor(reason: string): string {
  return /fewer than 2 track points|non-positive duration/u.test(reason)
    ? NO_TRACK_MESSAGE
    : PARSE_FAILURE_MESSAGE;
}

async function reasonFor(text: string): Promise<string> {
  const failure = await failureFrom(() => parse(text));
  expect(failure.message).toBe(sentenceFor(failure.reason));
  return failure.reason;
}

describe("gpx: a well-formed track", () => {
  it("reads the start, the duration and the distance off the points", async () => {
    const draft = await parse(
      gpxWith(
        `<trkseg>${point(44.98, -93.27, START)}${point(45, -93.27, LATER)}</trkseg>`,
      ),
    );

    expect(draft.startedAt).toBe(Math.floor(Date.parse(START) / 1000));
    expect(draft.durationS).toBe(1800);
    expect(draft.distanceM).toBeCloseTo(2224, -2);
    expect(draft.lat).toBeCloseTo(44.98, 6);
    expect(draft.lng).toBeCloseTo(-93.27, 6);
    expect(draft.indoor).toBe(false);
  });

  it("sums every segment of every track", async () => {
    // One `<trk>` with two `<trkseg>`s is a paused run; two `<trk>`s is a
    // multi-sport export. Both are one run's worth of points.
    const oneSegment = await parse(
      gpxWith(
        `<trkseg>${point(44.98, -93.27, START)}${point(45, -93.27, LATER)}</trkseg>`,
      ),
    );
    const twoSegments = await parse(
      gpxWith(
        `<trkseg>${point(44.98, -93.27, START)}${point(44.99, -93.27, "2026-01-15T07:15:00Z")}</trkseg>` +
          `<trkseg>${point(44.99, -93.27, "2026-01-15T07:16:00Z")}${point(45, -93.27, LATER)}</trkseg>`,
      ),
    );

    expect(twoSegments.distanceM).toBeCloseTo(oneSegment.distanceM, 0);
    expect(twoSegments.durationS).toBe(1800);
  });

  it("skips a trackpoint missing any of its three fields", async () => {
    // A point with no time cannot be ordered, and one with no position
    // cannot be measured. Both are dropped rather than read as zero.
    const withGaps = await parse(
      gpxWith(
        `<trkseg>${point(44.98, -93.27, START)}` +
          `<trkpt lat="45" lon="-93.27"></trkpt>` +
          `<trkpt lon="-93.27"><time>${LATER}</time></trkpt>` +
          `<trkpt lat="45"><time>${LATER}</time></trkpt>` +
          `${point(45, -93.27, LATER)}</trkseg>`,
      ),
    );

    expect(withGaps.durationS).toBe(1800);
    expect(withGaps.distanceM).toBeCloseTo(2224, -2);
  });

  it("ignores a trackpoint that is not an element", async () => {
    const withText = await parse(
      gpxWith(
        `<trkseg>${point(44.98, -93.27, START)}<trkpt>stray text</trkpt>${point(45, -93.27, LATER)}</trkseg>`,
      ),
    );
    expect(withText.durationS).toBe(1800);
  });
});

describe("gpx: every way it refuses", () => {
  it("says when the bytes are not valid text", async () => {
    const notText = new Uint8Array([0xff, 0xfe, 0x00, 0x00]).buffer;
    await expect(gpxSource.parse(notText)).rejects.toThrow(
      PARSE_FAILURE_MESSAGE,
    );
    const failure = await failureFrom(() => gpxSource.parse(notText));
    expect(failure.reason).toContain("not valid");
    expect(failure.cause).toBeDefined();
  });

  it("says when there are fewer than two usable points", async () => {
    const single = await reasonFor(
      gpxWith(`<trkseg>${point(44.98, -93.27, START)}</trkseg>`),
    );
    expect(single).toContain("fewer than 2 track points");
    expect(await reasonFor(gpxWith("<trkseg></trkseg>"))).toContain(
      "fewer than 2 track points",
    );
  });

  it("says when there is no track at all", async () => {
    expect(await reasonFor('<?xml version="1.0"?><gpx></gpx>')).toContain(
      "fewer than 2 track points",
    );
    expect(await reasonFor('<?xml version="1.0"?><other/>')).toContain(
      "fewer than 2 track points",
    );
  });

  it("says when the track has no duration or no distance", async () => {
    // Two points at the same instant, and two at the same place. Either
    // one produces a run that is not a run.
    const noTime = await reasonFor(
      gpxWith(
        `<trkseg>${point(44.98, -93.27, START)}${point(45, -93.27, START)}</trkseg>`,
      ),
    );
    const noDistance = await reasonFor(
      gpxWith(
        `<trkseg>${point(44.98, -93.27, START)}${point(44.98, -93.27, LATER)}</trkseg>`,
      ),
    );
    expect(noTime).toContain("non-positive duration or distance");
    expect(noDistance).toContain("non-positive duration or distance");
  });

  it("says when time runs backwards", async () => {
    const backwards = await reasonFor(
      gpxWith(
        `<trkseg>${point(44.98, -93.27, LATER)}${point(45, -93.27, START)}</trkseg>`,
      ),
    );
    expect(backwards).toContain("non-positive duration or distance");
  });

  it("says when the assembled run is not one the contract accepts", async () => {
    // A latitude past the pole reaches the schema, not a guard here — and
    // that is the last thing between a corrupt file and a stored run.
    const outOfRange = await reasonFor(
      gpxWith(
        `<trkseg>${point(91, -93.27, START)}${point(92, -93.27, LATER)}</trkseg>`,
      ),
    );
    expect(outOfRange).toContain("runDraftSchema");
  });

  it("expands no entities, however the file asks", async () => {
    // `processEntities: false` is the XXE guard, and an *internal* entity
    // is how to see it working: with expansion on, `&later;` becomes a
    // valid timestamp and this file parses. With it off the text stays
    // literal, the point has no readable time, and the run is refused.
    const withEntity = `<?xml version="1.0"?>
<!DOCTYPE gpx [<!ENTITY later "${LATER}">]>
<gpx><trk><trkseg>${point(44.98, -93.27, START)}<trkpt lat="45" lon="-93.27"><time>&later;</time></trkpt></trkseg></trk></gpx>`;

    expect(await reasonFor(withEntity)).toContain("fewer than 2 track points");
  });

  it("keeps the underlying failure as the cause", async () => {
    // The reason says which of the ways this was; the cause is what the
    // library actually complained about.
    const rejected = `<?xml version="1.0"?>
<!DOCTYPE gpx [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<gpx><trk><trkseg>${point(44.98, -93.27, START)}</trkseg></trk></gpx>`;
    const xmlFailure = await failureFrom(() => parse(rejected));
    expect(xmlFailure.reason).toContain("XML parser threw");
    expect(xmlFailure.cause).toBeDefined();

    const outOfRange = gpxWith(
      `<trkseg>${point(91, -93.27, START)}${point(92, -93.27, LATER)}</trkseg>`,
    );
    const schemaFailure = await failureFrom(() => parse(outOfRange));
    expect(schemaFailure.cause).toBeDefined();
  });

  it("names the format in the reason, not just the failure", async () => {
    // GPX and TCX share the decode step; the reason is how a maintainer
    // tells which file class is failing.
    const failure = await failureFrom(() =>
      parse('<?xml version="1.0"?><other/>'),
    );
    expect(failure.reason.startsWith("gpx:")).toBe(true);

    // Including the shared decode step, which takes the format as an
    // argument — the one place the two parsers could report each other's.
    const rejected = `<?xml version="1.0"?>
<!DOCTYPE gpx [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<gpx/>`;
    const shared = await failureFrom(() => parse(rejected));
    expect(shared.reason.startsWith("gpx:")).toBe(true);
  });

  it("ignores a track or segment that is not an element", async () => {
    const textTrack = await reasonFor(
      '<?xml version="1.0"?><gpx><trk>plain text</trk></gpx>',
    );
    const textSegment = await reasonFor(gpxWith("<trkseg>plain text</trkseg>"));
    expect(textTrack).toContain("fewer than 2 track points");
    expect(textSegment).toContain("fewer than 2 track points");
  });
});

// Metres per degree of latitude, as the haversine reads a step due north.
const METRES_PER_DEGREE = (6_371_000 * Math.PI) / 180;
const BASE_MS = Date.parse(START);

/**
A point `metres` north of the start, `seconds` into the run.
*/
function at(metres: number, seconds: number, ele?: number): string {
  const lat = 44.98 + metres / METRES_PER_DEGREE;
  const time = new Date(BASE_MS + seconds * 1000).toISOString();
  const elevation = ele === undefined ? "" : `<ele>${String(ele)}</ele>`;
  return `<trkpt lat="${String(lat)}" lon="-93.27">${elevation}<time>${time}</time></trkpt>`;
}

/**
Parses a track of the given segments, each a list of points.
*/
function parseSegments(...segments: string[][]): Promise<RunDraft> {
  const body = segments
    .map((points) => `<trkseg>${points.join("")}</trkseg>`)
    .join("");
  return parse(gpxWith(body));
}

/**
One segment, a point every 5 s and 15 m apart, at each of these altitudes.
*/
function parseAltitudes(altitudes: readonly number[]): Promise<RunDraft> {
  return parseSegments(
    altitudes.map((ele, index) => at(index * 15, index * 5, ele)),
  );
}

describe("gpx: moving time, pauses left out (D-111)", () => {
  it("leaves out a stand-still and a segment break, and counts a gap run through", async () => {
    const draft = await parse(pausedClimbGpx);

    expect(draft.durationS).toBe(340);
    expect(draft.movingS).toBe(70);
  });

  it("counts a gap of exactly the pause threshold as recording, however still", async () => {
    // Ten seconds stood still, then five moving: a watch recording every
    // ten seconds is not paused between its points.
    expect(PAUSE_GAP_S).toBe(10);
    const draft = await parseSegments([at(0, 0), at(0, 10), at(15, 15)]);
    expect(draft.movingS).toBe(15);
  });

  it("leaves out a still gap one second longer", async () => {
    const draft = await parseSegments([at(0, 0), at(0, 11), at(15, 16)]);
    expect(draft.movingS).toBe(5);
  });

  it("counts a long gap covered at the stopped speed, and leaves out a slower one", async () => {
    // 40 s at 0.5 m/s is 20 m. Covering exactly that is moving; a metre
    // less is stood still. Distance is read in whole metres.
    expect(STOPPED_SPEED_MPS).toBe(0.5);
    const atSpeed = await parseSegments([at(0, 0), at(20, 40), at(35, 45)]);
    const slower = await parseSegments([at(0, 0), at(19.4, 40), at(34.4, 45)]);

    expect(atSpeed.movingS).toBe(45);
    expect(slower.movingS).toBe(5);
  });

  it("leaves out the time across a segment break, however short", async () => {
    const draft = await parseSegments(
      [at(0, 0), at(15, 5)],
      [at(24, 8), at(39, 13)],
    );

    expect(draft.durationS).toBe(13);
    expect(draft.movingS).toBe(10);
  });

  it("stores no moving time when every gap was a pause", async () => {
    // A sparse file walked slowly reads as all pause. Nothing measured is
    // not zero: the read API falls back to the duration.
    const draft = await parseSegments([at(0, 0), at(60, 300)]);

    expect(draft.durationS).toBe(300);
    expect(draft.movingS).toBeUndefined();
  });
});

describe("gpx: the climb (D-111)", () => {
  it("reads a jittery flat track as no climb", async () => {
    // GPS altitude on a flat loop: every rise is under the threshold.
    expect(ELEVATION_HYSTERESIS_M).toBe(5);
    const jitter = [100, 103, 98.5, 102, 99, 103.4, 98.6, 101, 100.2, 103];
    const draft = await parseAltitudes(jitter);

    expect(draft.elevationGainM).toBe(0);
  });

  it("reads a real climb in full, through the noise on it", async () => {
    const climb = [100, 104, 103, 109, 112, 111, 118, 124, 123, 131, 150];
    const draft = await parseAltitudes(climb);

    expect(draft.elevationGainM).toBe(50);
  });

  it("reads the climb in the fixture, across its segment break", async () => {
    const draft = await parse(pausedClimbGpx);
    expect(draft.elevationGainM).toBeCloseTo(30.5, 6);
  });

  it("skips points with no altitude, and says nothing without two", async () => {
    const partial = await parseSegments([
      at(0, 0, 100),
      at(15, 5),
      at(30, 10, 110),
    ]);
    const one = await parseSegments([at(0, 0, 100), at(15, 5)]);
    const none = await parseSegments([at(0, 0), at(15, 5)]);

    expect(partial.elevationGainM).toBe(10);
    expect(one.elevationGainM).toBeUndefined();
    expect(none.elevationGainM).toBeUndefined();
  });
});
