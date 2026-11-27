/**
 * One evidence line per chosen piece: a counted fact as B2 draws it and as
 * a screen reader says it, in the reader's unit. Temperatures come from
 * `bandForms` and `worksAtForms`, never formatted here.
 */
import type { TempUnit } from "../../../lib/contracts";
import { bandForms, worksAtForms } from "../../../lib/contracts/measures";
import type { CohortRung, EvidenceFact, ScoredPiece } from "../contract";
import { fill } from "./words";
import { words } from "./words-data";

/**
A measured line both ways: `shown` with its brackets drawn, `said` without.
*/
export interface Line {
  shown: string;
  said: string;
}

type Fact<K extends EvidenceFact["kind"]> = Extract<EvidenceFact, { kind: K }>;

/**
 * The fewest distinct runners a cohort share is shown over: D-108's floor,
 * the same 5 as the feed's consensus (`MIN_RUNNERS`; a test pins the two).
 */
const COHORT_RUNNER_FLOOR = 5;

/**
"once", "twice", "3 times".
*/
export function timesWord(count: number): string {
  if (count === 1) return words.once.text;
  if (count === 2) return words.twice.text;
  return fill("times", { count: String(count) });
}

/**
"1 run", "11 runs".
*/
export function runsWord(count: number): string {
  return count === 1
    ? words.runOne.text
    : fill("runMany", { count: String(count) });
}

/**
 * A share as a whole percent, half rounded up, in integers so 62.5 is
 * never 62.4999.
 */
export function percentOf(part: number, whole: number): number {
  return Math.floor((200 * part + whole) / (2 * whole));
}

function pieceLine(fact: Fact<"personal-piece">, unit: TempUnit): Line {
  const band = bandForms(fact.bandFloorC, unit);
  const counts = { dialed: String(fact.dialed), of: String(fact.of) };
  return {
    shown: fill("pieceDialed", { ...counts, band: band.shown }),
    said: fill("pieceDialedSaid", { ...counts, band: band.said }),
  };
}

const FLAG_WORDS = {
  too_much: { shown: "flagTooMuch", said: "flagTooMuchSaid" },
  not_enough: { shown: "flagNotEnough", said: "flagNotEnoughSaid" },
} as const;

function flagLine(fact: Fact<"personal-flag">, unit: TempUnit): Line {
  const band = bandForms(fact.bandFloorC, unit);
  const times = timesWord(fact.times);
  const keys = FLAG_WORDS[fact.flag];
  return {
    shown: fill(keys.shown, { times: times.toUpperCase(), band: band.shown }),
    said: fill(keys.said, { times, band: band.said }),
  };
}

function bandLine(fact: Fact<"personal-band">, unit: TempUnit): Line {
  const band = bandForms(fact.bandFloorC, unit);
  const runs = runsWord(fact.cold + fact.dialed + fact.warm);
  return {
    shown: fill("bandRuns", { runs: runs.toUpperCase(), band: band.shown }),
    said: fill("bandRunsSaid", { runs, band: band.said }),
  };
}

const COHORT_WORDS: Readonly<
  Record<
    CohortRung,
    {
      shown: "cohortClimate" | "cohortEveryone";
      said: "cohortClimateSaid" | "cohortEveryoneSaid";
    }
  >
> = {
  "zone-and-thermal": { shown: "cohortClimate", said: "cohortClimateSaid" },
  zone: { shown: "cohortClimate", said: "cohortClimateSaid" },
  everyone: { shown: "cohortEveryone", said: "cohortEveryoneSaid" },
};

function cohortLine(
  fact: Fact<"cohort-share">,
  unit: TempUnit,
): Line | undefined {
  if (fact.bandRunners < COHORT_RUNNER_FLOOR) return undefined;
  const band = bandForms(fact.bandFloorC, unit);
  const percent = String(percentOf(fact.groupRunners, fact.bandRunners));
  const keys = COHORT_WORDS[fact.rung];
  return {
    shown: fill(keys.shown, { percent, band: band.shown }),
    said: fill(keys.said, { percent, band: band.said }),
  };
}

function estimateLine(
  fact: Fact<"estimate">,
  unit: TempUnit,
): Line | undefined {
  const range = worksAtForms(fact.range, unit);
  if (range === undefined) return undefined;
  return {
    shown: fill("worksAt", { range: range.shown }),
    said: fill("worksAtSaid", { range: range.said }),
  };
}

/**
 * A fact as a line, or nothing when it has nothing to show: a cohort share
 * under the floor, an estimate with no ends.
 */
export function factLine(fact: EvidenceFact, unit: TempUnit): Line | undefined {
  switch (fact.kind) {
    case "personal-piece": {
      return pieceLine(fact, unit);
    }
    case "personal-flag": {
      return flagLine(fact, unit);
    }
    case "personal-band": {
      return bandLine(fact, unit);
    }
    case "cohort-share": {
      return cohortLine(fact, unit);
    }
    case "estimate": {
      return estimateLine(fact, unit);
    }
  }
}

/**
 * Which fact a piece's line shows, strongest first: the runner's own runs
 * in it, then their flags on it, then their runs in the band, then the
 * cohort, then the estimate.
 */
const STRENGTH: Readonly<Record<EvidenceFact["kind"], number>> = {
  "personal-piece": 0,
  "personal-flag": 1,
  "personal-band": 2,
  "cohort-share": 3,
  estimate: 4,
};

/**
 * Whether a fact is about this piece: one naming a piece names this one,
 * one naming a group names this piece's group.
 */
function isAbout(fact: EvidenceFact, piece: ScoredPiece): boolean {
  if ("pieceId" in fact) return fact.pieceId === piece.pieceId;
  if ("group" in fact) return fact.group === piece.group;
  return true;
}

/**
 * A piece's one line: its strongest fact that shows anything, the first of
 * its kind in the scorer's order on a tie; `NO VERDICTS YET` when none.
 */
export function pieceEvidenceLine(piece: ScoredPiece, unit: TempUnit): Line {
  const facts = piece.evidence
    .filter((fact) => isAbout(fact, piece))
    .toSorted((a, b) => STRENGTH[a.kind] - STRENGTH[b.kind]);
  for (const fact of facts) {
    const line = factLine(fact, unit);
    if (line !== undefined) return line;
  }
  return { shown: words.noVerdicts.text, said: words.noVerdictsSaid.text };
}
