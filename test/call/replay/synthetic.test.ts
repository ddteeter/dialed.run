import { describe, expect, it } from "vitest";

import { CALL_VERDICT_THRESHOLD, uiGroupFor } from "../../../src/lib/contracts";
import { bandFloorC } from "../../../src/lib/contracts/temperature";
import {
  estimateTempRange,
  type ThermalInput,
} from "../../../src/lib/contracts/thermal";
import type {
  CallRequest,
  ClosetPiece,
  Scorer,
} from "../../../src/modules/call/contract";
import {
  casesFrom,
  dressFor,
  measure,
  replay,
  syntheticCloset,
  syntheticPersonas,
  type Persona,
  type ReplayMetrics,
} from "../../../src/modules/call/replay";
import {
  COHORT_FLOOR,
  flagWorn,
  precipFor,
  seededRandom,
  verdictFor,
} from "../../../src/modules/call/replay/synthetic";
import { MIN_RUNNERS } from "../../../src/modules/feed/consensus/consensus";
import { CLOSET, result } from "./fixtures";

const personas = syntheticPersonas(1);

function persona(name: string): Persona {
  const found = personas.find((p) => p.name === name);
  if (found === undefined) throw new Error(`no persona ${name}`);
  return found;
}

function feelOf(request: CallRequest): number {
  return request.conditions.kind === "forecast"
    ? request.conditions.feelsLikeC
    : NaN;
}

/**
 * A fake scorer that dresses for the forecast moved by `offsetC`, from the
 * closet `closetFor` leaves it. Lives only in this test.
 */
function dressingScorer(
  offsetC: number,
  closetFor: (
    closet: readonly ClosetPiece[],
    feelC: number,
  ) => readonly ClosetPiece[] = (closet) => closet,
): Scorer {
  return (request) => {
    const feelC = feelOf(request);
    const kit = dressFor(closetFor(request.closet, feelC), feelC + offsetC).map(
      (piece) => ({ ...piece, score: 1, evidence: [] }),
    );
    return result(kit);
  };
}

function metricsOf(p: Persona, scorer: Scorer): ReplayMetrics {
  return measure(replay(scorer, casesFrom(p.history, p.cohort)));
}

function rates(m: ReplayMetrics): [number, number] {
  return [
    m.dialedAgreement.hits / m.dialedAgreement.of,
    m.direction.hits / m.direction.of,
  ];
}

function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) {
    h = Math.imul(h, 31) + (text.codePointAt(i) ?? 0);
    h = Math.trunc(h % 2 ** 32);
  }
  return h;
}

describe("seededRandom", () => {
  it("is mulberry32", () => {
    const random = seededRandom(1);
    expect([random(), random(), random()]).toEqual([
      0.6270739405881613, 0.002735721180215478, 0.5274470399599522,
    ]);
  });

  it("reads its seed as 32 bits", () => {
    expect(seededRandom(2 ** 32 + 1)()).toBe(seededRandom(1)());
  });
});

describe("syntheticPersonas", () => {
  it("gives deep-equal personas for one seed and different ones for two", () => {
    expect(syntheticPersonas(1)).toEqual(personas);
    expect(syntheticPersonas(2)).not.toEqual(personas);
  });

  it("is pinned for seed 1", () => {
    expect(personas.map((p) => p.name)).toEqual([
      "runs-cold",
      "runs-warm",
      "sparse",
      "one-band",
      "trip",
      "flagged",
    ]);
    expect(persona("runs-cold").history.runs[0]).toEqual({
      runId: "runs-cold-000",
      startedAt: 1_767_618_000,
      judgedFeelsLikeC: 9.8,
      precip: "wet",
      source: "visualcrossing",
      verdict: 2,
      worn: [
        { pieceId: "base-layer", group: "tops" },
        { pieceId: "tights", group: "bottoms" },
        { pieceId: "jacket", group: "outer" },
        { pieceId: "shoes", group: "shoes" },
      ],
    });
    expect(hash(JSON.stringify(personas))).toBe(648_106_896);
  });

  it("gives every runner a pseudonym, the home zone and one run a day", () => {
    for (const p of personas) {
      expect(p.history.runnerId).toBe(`synthetic-${p.name}`);
      expect(p.history.runner.climateZone).toBe("Cfb");
      expect(p.history.closet).toEqual(syntheticCloset());
      const runs = p.history.runs;
      expect(new Set(runs.map((r) => r.runId)).size).toBe(runs.length);
      for (const [i, run] of runs.entries()) {
        expect(run.source).toBe("visualcrossing");
        expect(Math.floor((run.startedAt - 1_767_571_200) / 86_400)).toBe(i);
        expect(Math.round(run.judgedFeelsLikeC * 10)).toBeCloseTo(
          run.judgedFeelsLikeC * 10,
          9,
        );
      }
    }
  });

  it("starts runs on the hour, between 06:00 and 19:00", () => {
    const hours = new Set(
      personas.flatMap((p) =>
        p.history.runs.map((r) => (r.startedAt % 86_400) / 3600),
      ),
    );
    expect([...hours].toSorted((a, b) => a - b)).toEqual([
      6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    ]);
  });

  it("dresses each run for its feel and gives the verdict the gap earns", () => {
    for (const p of personas) {
      for (const run of p.history.runs) {
        const ids = run.worn.map((w) => w.pieceId);
        expect(ids).toContain("shoes");
        expect(run.worn.filter((w) => w.group === "tops")).toHaveLength(1);
        expect(run.worn.filter((w) => w.group === "bottoms")).toHaveLength(1);
      }
    }
  });
});

describe("the personas' truths", () => {
  it("runs cold: a scorer that knows beats one that ignores it", () => {
    const p = persona("runs-cold");
    expect(p.history.runner.thermalLevel).toBe(2);
    expect(p.needOffsetC).toBeCloseTo(-4.4, 9);
    expect(p.history.runs).toHaveLength(60);
    const [knowsAgree, knowsDirection] = rates(
      metricsOf(p, dressingScorer(p.needOffsetC)),
    );
    const [ignoresAgree, ignoresDirection] = rates(
      metricsOf(p, dressingScorer(0)),
    );
    expect(knowsAgree).toBeGreaterThan(ignoresAgree);
    expect(knowsDirection).toBeGreaterThan(ignoresDirection);
  });

  it("runs warm: a scorer that knows beats one that ignores it", () => {
    const p = persona("runs-warm");
    expect(p.history.runner.thermalLevel).toBe(-2);
    expect(p.needOffsetC).toBeCloseTo(4.4, 9);
    const [knowsAgree, knowsDirection] = rates(
      metricsOf(p, dressingScorer(p.needOffsetC)),
    );
    const [ignoresAgree, ignoresDirection] = rates(
      metricsOf(p, dressingScorer(0)),
    );
    expect(knowsAgree).toBeGreaterThan(ignoresAgree);
    expect(knowsDirection).toBeGreaterThan(ignoresDirection);
    // The wrong way round does worse than ignoring it.
    const backwards = metricsOf(p, dressingScorer(-p.needOffsetC));
    expect(rates(backwards)[0]).toBeLessThan(ignoresAgree);
  });

  it("sparse: fewer verdicts than the Call's threshold", () => {
    const p = persona("sparse");
    expect(p.history.runs).toHaveLength(CALL_VERDICT_THRESHOLD - 1);
    expect(p.history.runner.thermalLevel).toBeUndefined();
    expect(p.needOffsetC).toBe(0);
  });

  it("one band: every verdict, and every cell, at 10°", () => {
    const p = persona("one-band");
    expect(p.history.runs).toHaveLength(40);
    expect(
      new Set(p.history.runs.map((r) => bandFloorC(r.judgedFeelsLikeC))),
    ).toEqual(new Set([10]));
    expect(new Set(p.cohort.map((c) => c.bandFloorC))).toEqual(new Set([10]));
  });

  it("trip: six hot runs, in bands only the everyone rung covers", () => {
    const p = persona("trip");
    const runs = p.history.runs;
    expect(runs).toHaveLength(50);
    const hot = runs.filter((r) => r.judgedFeelsLikeC >= 26);
    expect(hot.map((r) => r.runId)).toEqual([
      "trip-030",
      "trip-031",
      "trip-032",
      "trip-033",
      "trip-034",
      "trip-035",
    ]);
    for (const run of hot) expect(run.judgedFeelsLikeC).toBeLessThan(34.1);
    const home = runs.filter((r) => !hot.includes(r));
    for (const run of home) {
      expect(run.judgedFeelsLikeC).toBeGreaterThanOrEqual(-4);
      expect(run.judgedFeelsLikeC).toBeLessThan(18.1);
    }
    const hotBands = new Set(hot.map((r) => bandFloorC(r.judgedFeelsLikeC)));
    const hotCells = p.cohort.filter((c) => hotBands.has(c.bandFloorC));
    for (const cell of hotCells) {
      expect(cell.rung).toBe("everyone");
      expect(cell.climateZone).toBeUndefined();
    }
    const zoneCells = p.cohort.filter((c) => c.rung === "zone");
    expect(zoneCells.length).toBeGreaterThan(0);
    for (const cell of zoneCells) {
      expect(hotBands.has(cell.bandFloorC)).toBe(false);
      expect(cell.climateZone).toBe("Cfb");
    }
    expect(new Set(p.cohort.map((c) => c.rung))).toEqual(
      new Set(["zone", "everyone"]),
    );
  });

  it("flagged: the long sleeve is flagged, and the run a bit warm, only above 10°", () => {
    const p = persona("flagged");
    const withSleeve = p.history.runs.filter((r) =>
      r.worn.some((w) => w.pieceId === "long-sleeve"),
    );
    const flagged = withSleeve.filter((r) => r.judgedFeelsLikeC > 10);
    expect(flagged.length).toBeGreaterThan(0);
    expect(withSleeve.length).toBeGreaterThan(flagged.length);
    for (const run of withSleeve) {
      const sleeve = run.worn.find((w) => w.pieceId === "long-sleeve");
      expect(sleeve?.flag).toBe(
        run.judgedFeelsLikeC > 10 ? "too_much" : undefined,
      );
    }
    for (const run of flagged) expect(run.verdict).toBe(1);
    const flags = p.history.runs
      .flatMap((r) => r.worn)
      .filter((w) => w.flag !== undefined);
    expect(flags).toHaveLength(flagged.length);
    const knows = dressingScorer(0, (closet, feelC) =>
      feelC > 10 ? closet.filter((c) => c.pieceId !== "long-sleeve") : closet,
    );
    const flaggedCases = casesFrom(p.history, p.cohort).filter((c) =>
      c.worn.some((w) => w.flag !== undefined),
    );
    const direction = (scorer: Scorer) =>
      measure(replay(scorer, flaggedCases)).direction;
    expect(direction(knows)).toEqual({
      hits: flaggedCases.length,
      of: flaggedCases.length,
      noCall: 0,
    });
    expect(direction(dressingScorer(0)).hits).toBeLessThan(flaggedCases.length);
  });

  it("gives the narrowest rung only to a runner with a thermal level", () => {
    const narrow = persona("runs-cold").cohort.filter(
      (c) => c.rung === "zone-and-thermal",
    );
    expect(narrow.length).toBeGreaterThan(0);
    for (const cell of narrow) {
      expect(cell.thermalLevel).toBe(2);
      expect(cell.climateZone).toBe("Cfb");
    }
  });
});

describe("the cohort cells", () => {
  const cells = personas.flatMap((p) => p.cohort);

  it("pins the floor to the consensus module's", () => {
    expect(COHORT_FLOOR).toBe(MIN_RUNNERS);
  });

  it("count five or more runners, and no more in a group than in its band", () => {
    for (const cell of cells) {
      expect(cell.groupRunners).toBeGreaterThanOrEqual(COHORT_FLOOR);
      expect(cell.groupRunners).toBeLessThanOrEqual(cell.bandRunners);
      expect(cell.verdicts[0]).toBeGreaterThanOrEqual(cell.groupRunners);
      expect(cell.verdicts[0]).toBeLessThanOrEqual(cell.groupRunners + 10);
      expect(cell.verdicts[-2]).toBeLessThanOrEqual(3);
      expect(cell.verdicts[-1]).toBeLessThanOrEqual(6);
      expect(cell.verdicts[1]).toBeLessThanOrEqual(6);
      expect(cell.verdicts[2]).toBeLessThanOrEqual(3);
    }
    const bandRunners = new Set(cells.map((c) => c.bandRunners));
    expect(Math.min(...bandRunners)).toBe(COHORT_FLOOR);
    expect(Math.max(...bandRunners)).toBe(COHORT_FLOOR + 40);
    expect(bandRunners.size).toBe(41);
  });

  it("cover each band a persona ran in, for every class and group, on each rung", () => {
    const p = persona("runs-cold");
    const bands = new Set(
      p.history.runs.map((r) => bandFloorC(r.judgedFeelsLikeC)),
    );
    expect(p.cohort).toHaveLength(bands.size * 3 * 3 * 6);
    expect(p.cohort.map((c) => c.bandFloorC)).toEqual(
      p.cohort.map((c) => c.bandFloorC).toSorted((a, b) => a - b),
    );
  });
});

describe("syntheticCloset", () => {
  const inputs: [string, ThermalInput][] = [
    ["tee", { category: "top", weight: "light" }],
    ["long-sleeve", { category: "top", weight: "mid" }],
    ["base-layer", { category: "top", weight: "heavy" }],
    ["shorts", { category: "bottom", weight: "light" }],
    ["tights", { category: "bottom", weight: "mid" }],
    ["winter-tights", { category: "bottom", weight: "heavy" }],
    [
      "shell",
      { category: "top", layer: "outer", weight: "light", windResistant: true },
    ],
    ["jacket", { category: "top", layer: "outer", weight: "mid" }],
    ["gloves", { category: "gloves", weight: "light" }],
    ["shoes", { category: "shoes" }],
  ];

  it("takes groups and ranges from the contracts", () => {
    expect(syntheticCloset()).toEqual(
      inputs.map(([pieceId, input]) => ({
        pieceId,
        group: uiGroupFor(input.category, input.layer),
        estimate: estimateTempRange(input),
      })),
    );
    expect(syntheticCloset().map((p) => p.group)).toEqual([
      "tops",
      "tops",
      "tops",
      "bottoms",
      "bottoms",
      "bottoms",
      "outer",
      "outer",
      "hands_head",
      "shoes",
    ]);
  });
});

describe("dressFor", () => {
  const closet = syntheticCloset();
  const ids = (feelC: number, from: readonly ClosetPiece[] = closet) =>
    dressFor(from, feelC).map((w) => w.pieceId);

  it("wears the lightest piece in each group whose range holds the feel", () => {
    expect(dressFor(closet, 3)).toEqual([
      { pieceId: "base-layer", group: "tops" },
      { pieceId: "tights", group: "bottoms" },
      { pieceId: "shell", group: "outer" },
      { pieceId: "gloves", group: "hands_head" },
      { pieceId: "shoes", group: "shoes" },
    ]);
  });

  it("reads a range's ends as inclusive", () => {
    expect(ids(13)).toContain("tee");
    expect(ids(12.9)).toContain("long-sleeve");
    expect(ids(2.9)).toContain("jacket");
    expect(ids(16)).toContain("shell");
    expect(ids(16.1)).not.toContain("shell");
    expect(ids(12)).toContain("gloves");
    expect(ids(12.1)).not.toContain("gloves");
    expect(ids(1.9)).not.toContain("gloves");
  });

  it("keeps the first of two pieces with the same floor", () => {
    expect(ids(20, CLOSET)).toEqual(["a-tee", "shorts", "softshell", "shoes"]);
    expect(ids(-10, CLOSET)).toEqual(["parka", "shoes"]);
    expect(ids(0, CLOSET)).toEqual(["z-base", "tights", "jacket", "shoes"]);
  });
});

describe("verdictFor", () => {
  it("is dialed within 2°, cold dressed for warmer, warm dressed for colder", () => {
    expect(verdictFor(2, 0)).toBe(0);
    expect(verdictFor(2.1, 0)).toBe(-1);
    expect(verdictFor(5, 0)).toBe(-1);
    expect(verdictFor(5.1, 0)).toBe(-2);
    expect(verdictFor(-2, 0)).toBe(0);
    expect(verdictFor(-2.1, 0)).toBe(1);
    expect(verdictFor(-5, 0)).toBe(1);
    expect(verdictFor(-5.1, 0)).toBe(2);
    expect(verdictFor(10, 8)).toBe(0);
    expect(verdictFor(10, 13)).toBe(1);
  });
});

describe("precipFor", () => {
  it("splits a draw into half dry, three tenths damp, a fifth wet", () => {
    expect(precipFor(0)).toBe("dry");
    expect(precipFor(0.49)).toBe("dry");
    expect(precipFor(0.5)).toBe("damp");
    expect(precipFor(0.79)).toBe("damp");
    expect(precipFor(0.8)).toBe("wet");
  });
});

describe("flagWorn", () => {
  const worn = [
    { pieceId: "long-sleeve", group: "tops" as const },
    { pieceId: "tights", group: "bottoms" as const },
  ];
  const flag = { pieceId: "long-sleeve", aboveC: 10 };

  it("flags only that piece, and only above the feel", () => {
    expect(flagWorn(flag, worn, 10.1)).toEqual([
      { pieceId: "long-sleeve", group: "tops", flag: "too_much" },
      { pieceId: "tights", group: "bottoms" },
    ]);
    expect(flagWorn(flag, worn, 10)).toEqual(worn);
    expect(flagWorn(undefined, worn, 30)).toEqual(worn);
  });
});
