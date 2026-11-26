import { describe, expect, it } from "vitest";

import { cohortCellFor } from "../../../src/modules/call/scorer/ladder";
import { aCell } from "./builders";

const SCOPE = { bandFloorC: 5, precip: "dry" } as const;
const DENVER_COLD = { climateZone: "denver", thermalLevel: 1 };

const everyone = aCell({ rung: "everyone" });
const zone = aCell({ rung: "zone", climateZone: "denver" });
const zoneAndThermal = aCell({
  rung: "zone-and-thermal",
  climateZone: "denver",
  thermalLevel: 1,
});

describe("the cohort's backoff ladder", () => {
  it("reads the narrowest rung, wherever it sits in the request", () => {
    expect(
      cohortCellFor(
        [everyone, zoneAndThermal, zone],
        DENVER_COLD,
        SCOPE,
        "tops",
      ),
    ).toBe(zoneAndThermal);
  });

  it("reads the zone when the narrowest rung has no cell", () => {
    expect(cohortCellFor([everyone, zone], DENVER_COLD, SCOPE, "tops")).toBe(
      zone,
    );
  });

  it("reads everyone when neither zone rung has a cell", () => {
    expect(cohortCellFor([everyone], DENVER_COLD, SCOPE, "tops")).toBe(
      everyone,
    );
  });

  it("reads nothing when no rung has a cell", () => {
    expect(cohortCellFor([], DENVER_COLD, SCOPE, "tops")).toBeUndefined();
  });

  it("backs off a rung whose cell is one runner short of the floor", () => {
    const thin = { ...zoneAndThermal, bandRunners: 4 };

    expect(
      cohortCellFor([thin, zone, everyone], DENVER_COLD, SCOPE, "tops"),
    ).toBe(zone);
  });

  it("reads a rung whose cell is exactly at the floor", () => {
    const atFloor = { ...zoneAndThermal, bandRunners: 5 };

    expect(
      cohortCellFor([atFloor, zone, everyone], DENVER_COLD, SCOPE, "tops"),
    ).toBe(atFloor);
  });

  it("backs off rung by rung, and to nothing when every cell is thin", () => {
    const thinNarrow = { ...zoneAndThermal, bandRunners: 4 };
    const thinZone = { ...zone, bandRunners: 4 };
    const thinEveryone = { ...everyone, bandRunners: 4 };

    expect(
      cohortCellFor(
        [thinNarrow, thinZone, everyone],
        DENVER_COLD,
        SCOPE,
        "tops",
      ),
    ).toBe(everyone);
    expect(
      cohortCellFor(
        [thinNarrow, thinZone, thinEveryone],
        DENVER_COLD,
        SCOPE,
        "tops",
      ),
    ).toBeUndefined();
  });

  it("does not read another zone's cells (reading 9: a zone is matched whole)", () => {
    const portland = { climateZone: "portland", thermalLevel: 1 };

    expect(
      cohortCellFor([zoneAndThermal, zone, everyone], portland, SCOPE, "tops"),
    ).toBe(everyone);
  });

  it("does not read another thermal level's cell", () => {
    const denverWarm = { climateZone: "denver", thermalLevel: -1 };

    expect(
      cohortCellFor(
        [zoneAndThermal, zone, everyone],
        denverWarm,
        SCOPE,
        "tops",
      ),
    ).toBe(zone);
  });

  it("reads the cell of a runner at thermal level zero", () => {
    const average = { ...zoneAndThermal, thermalLevel: 0 };

    expect(
      cohortCellFor(
        [zone, average],
        { climateZone: "denver", thermalLevel: 0 },
        SCOPE,
        "tops",
      ),
    ).toBe(average);
  });

  it("puts a runner with no thermal level on the zone rung", () => {
    const noLevelCell = aCell({
      rung: "zone-and-thermal",
      climateZone: "denver",
    });

    expect(
      cohortCellFor(
        [noLevelCell, zoneAndThermal, zone, everyone],
        { climateZone: "denver" },
        SCOPE,
        "tops",
      ),
    ).toBe(zone);
  });

  it("puts a runner with no zone on the everyone rung", () => {
    const noZoneCell = aCell({ rung: "zone" });
    const noZoneNarrowCell = aCell({
      rung: "zone-and-thermal",
      thermalLevel: 1,
    });

    expect(
      cohortCellFor(
        [noZoneNarrowCell, noZoneCell, zoneAndThermal, zone, everyone],
        { thermalLevel: 1 },
        SCOPE,
        "tops",
      ),
    ).toBe(everyone);
  });

  it("reads nothing for a runner with no zone when only zone cells exist", () => {
    expect(
      cohortCellFor([zoneAndThermal, zone], {}, SCOPE, "tops"),
    ).toBeUndefined();
  });

  it("reads only cells of the Call's band", () => {
    const nextBand = aCell({ bandFloorC: 10 });

    expect(cohortCellFor([nextBand], {}, SCOPE, "tops")).toBeUndefined();
  });

  it("reads only cells of the Call's condition class", () => {
    const wet = aCell({ precip: "wet" });

    expect(cohortCellFor([wet], {}, SCOPE, "tops")).toBeUndefined();
  });

  it("reads only cells of the garment group asked for (reading 8)", () => {
    const outer = aCell({ group: "outer" });

    expect(cohortCellFor([outer], {}, SCOPE, "tops")).toBeUndefined();
    expect(cohortCellFor([everyone, outer], {}, SCOPE, "outer")).toBe(outer);
  });

  it("reads the first of two cells on one rung", () => {
    const first = aCell({ bandRunners: 11 });
    const second = aCell({ bandRunners: 12 });

    expect(cohortCellFor([first, second], {}, SCOPE, "tops")).toBe(first);
  });

  it("reads nothing when the Call has no band", () => {
    expect(
      cohortCellFor([everyone], DENVER_COLD, undefined, "tops"),
    ).toBeUndefined();
  });
});
