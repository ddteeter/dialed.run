import { Encoder } from "@garmin/fitsdk";
import type {
  ActivityMesg,
  Encodable,
  FileIdMesg,
  SessionMesg,
} from "@garmin/fitsdk";
import { describe, expect, it } from "vitest";

import { PARSE_FAILURE_MESSAGE } from "../../src/modules/runs/parsers";
import { fitSource } from "../../src/modules/runs/parsers/fit";
import { gpxSource } from "../../src/modules/runs/parsers/gpx";
import { tcxSource } from "../../src/modules/runs/parsers/tcx";
// Vite inlines these as strings at build time (`?raw`) — the workers-pool
// sandbox has no host filesystem access, so fixtures can't be read at
// runtime with node:fs.
import validGpx from "./fixtures/valid.gpx?raw";
import malformedGpx from "./fixtures/malformed.gpx?raw";
import validTcx from "./fixtures/valid.tcx?raw";
import treadmillTcx from "./fixtures/treadmill.tcx?raw";
import malformedTcx from "./fixtures/malformed.tcx?raw";

function textBytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

// Global FIT message numbers (FIT SDK profile) — used directly rather than
// via `Profile.MesgNum.X` because that object is typed `Record<string,
// number>`, which under `noUncheckedIndexedAccess` widens every access to
// `number | undefined`.
const MESG_NUM = { FILE_ID: 0, SESSION: 18, ACTIVITY: 34 } as const;

function buildFitFile(hasStartPosition: boolean): ArrayBuffer {
  const encoder = new Encoder();
  const startTime = new Date("2026-08-15T12:00:00Z");

  const fileId: Encodable<FileIdMesg> = {
    mesgNum: MESG_NUM.FILE_ID,
    type: "activity",
    manufacturer: "garmin",
    product: 1,
    timeCreated: startTime,
  };
  encoder.writeMesg(fileId);

  const session: Encodable<SessionMesg> = {
    mesgNum: MESG_NUM.SESSION,
    timestamp: startTime,
    startTime,
    totalElapsedTime: 1800,
    totalTimerTime: 1800,
    totalDistance: 5000,
    sport: "running",
    ...(hasStartPosition && {
      startPositionLat: 536_870_912,
      startPositionLong: -1_073_741_824,
    }),
  };
  encoder.writeMesg(session);

  const activity: Encodable<ActivityMesg> = {
    mesgNum: MESG_NUM.ACTIVITY,
    timestamp: startTime,
    numSessions: 1,
    type: "manual",
  };
  encoder.writeMesg(activity);

  const bytes = encoder.close();
  return new Uint8Array(bytes).buffer;
}

describe("parsers (102 §3)", () => {
  describe("fit", () => {
    it("parses an outdoor session with a start position", async () => {
      const draft = await fitSource.parse(buildFitFile(true));
      expect(draft.indoor).toBe(false);
      expect(draft.durationS).toBe(1800);
      expect(draft.distanceM).toBe(5000);
      expect(draft.lat).toBeCloseTo(45, 0);
      expect(draft.lng).toBeCloseTo(-90, 0);
    });

    it("treadmill session (no GPS) imports as indoor", async () => {
      const draft = await fitSource.parse(buildFitFile(false));
      expect(draft.indoor).toBe(true);
      expect(draft.lat).toBeUndefined();
      expect(draft.lng).toBeUndefined();
      expect(draft.durationS).toBe(1800);
      expect(draft.distanceM).toBe(5000);
    });

    it("rejects a file that isn't FIT at all", async () => {
      const bytes = new TextEncoder().encode("not a fit file").buffer;
      await expect(fitSource.parse(bytes)).rejects.toThrow(
        PARSE_FAILURE_MESSAGE,
      );
    });
  });

  describe("gpx", () => {
    it("parses a valid track", async () => {
      const draft = await gpxSource.parse(textBytes(validGpx));
      expect(draft.indoor).toBe(false);
      expect(draft.durationS).toBe(600);
      expect(draft.distanceM).toBeGreaterThan(0);
      expect(draft.lat).toBeCloseTo(44.9778, 4);
      expect(draft.lng).toBeCloseTo(-93.265, 4);
    });

    it("rejects a track missing timestamps", async () => {
      await expect(gpxSource.parse(textBytes(malformedGpx))).rejects.toThrow(
        PARSE_FAILURE_MESSAGE,
      );
    });
  });

  describe("tcx", () => {
    it("parses a valid lap with GPS", async () => {
      const draft = await tcxSource.parse(textBytes(validTcx));
      expect(draft.indoor).toBe(false);
      expect(draft.durationS).toBe(1800);
      expect(draft.distanceM).toBe(5000);
      expect(draft.lat).toBeCloseTo(44.9778, 3);
    });

    it("treadmill lap (no Position) imports as indoor", async () => {
      const draft = await tcxSource.parse(textBytes(treadmillTcx));
      expect(draft.indoor).toBe(true);
      expect(draft.lat).toBeUndefined();
      expect(draft.durationS).toBe(1800);
      expect(draft.distanceM).toBe(5000);
    });

    it("rejects a lap missing TotalTimeSeconds", async () => {
      await expect(tcxSource.parse(textBytes(malformedTcx))).rejects.toThrow(
        PARSE_FAILURE_MESSAGE,
      );
    });
  });
});
