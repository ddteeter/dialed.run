/**
 * The confidence header above B2's kit, one per `Confidence`, and the verb
 * the kit is introduced with: `WEAR THIS` when the Call is sure of the
 * runner here, `PROBABLY WEAR` when it leans on others (C1b, O5).
 */
import type { TempUnit } from "../../../lib/contracts";
import { bandForms } from "../../../lib/contracts/measures";
import { CALL_VERDICT_THRESHOLD } from "../../../lib/contracts/profile";
import type { CallResult } from "../contract";
import type { Line } from "./lines";
import { runsWord } from "./lines";
import { fill } from "./words";
import { words } from "./words-data";

/**
 * Below the threshold there is no Call: C0b's count of verdicts still to
 * log. Above it, a title, an optional body and the kit's verb.
 */
export type B2Header =
  | { kind: "count"; title: string; remaining: number; noun: string }
  | {
      kind: "call";
      title: Line;
      body?: Line | undefined;
      verb: string;
    };

function plain(text: string): Line {
  return { shown: text, said: text };
}

function untilFirstCall(verdictsSoFar: number): B2Header {
  const remaining = Math.max(0, CALL_VERDICT_THRESHOLD - verdictsSoFar);
  return {
    kind: "count",
    title: words.untilFirstCall.text,
    remaining,
    noun:
      remaining === 1 ? words.moreVerdictOne.text : words.moreVerdictMany.text,
  };
}

/**
 * Whose runs a borrowed Call leans on: the runner's climate when any of
 * the kit's cohort shares comes from a zone rung, other runners otherwise.
 */
function borrowedSource(result: CallResult): string {
  const isFromZone = result.kit.some((piece) =>
    piece.evidence.some(
      (fact) => fact.kind === "cohort-share" && fact.rung !== "everyone",
    ),
  );
  return isFromZone ? words.sourceClimate.text : words.sourceOthers.text;
}

function borrowedBody(result: CallResult, unit: TempUnit): Line {
  const source = borrowedSource(result);
  if (result.bandFloorC === undefined) {
    return plain(fill("borrowedNoBand", { source }));
  }
  const band = bandForms(result.bandFloorC, unit);
  const runs = runsWord(result.personalRunsInBand);
  return {
    shown: fill("borrowedInBand", { runs, band: band.shown, source }),
    said: fill("borrowedInBand", { runs, band: band.said, source }),
  };
}

function runsTitle(
  result: CallResult,
  keys: {
    shown: "confident" | "probable";
    said: "confidentSaid" | "probableSaid";
  },
): Line {
  const runs = runsWord(result.personalRunsInBand);
  return {
    shown: fill(keys.shown, { runs: runs.toUpperCase() }),
    said: fill(keys.said, { runs }),
  };
}

/**
 * The header for a result. `verdictsSoFar` is the runner's count of
 * verdicts, which only the below-threshold header reads (`CallResult`
 * does not carry it).
 */
export function callHeader(
  result: CallResult,
  unit: TempUnit,
  verdictsSoFar: number,
): B2Header {
  switch (result.confidence) {
    case "below-threshold": {
      return untilFirstCall(verdictsSoFar);
    }
    case "best-guess": {
      return {
        kind: "call",
        title: plain(words.bestGuess.text),
        body: plain(words.bestGuessBody.text),
        verb: words.probablyWear.text,
      };
    }
    case "borrowed": {
      return {
        kind: "call",
        title: plain(words.borrowed.text),
        body: borrowedBody(result, unit),
        verb: words.probablyWear.text,
      };
    }
    case "probable": {
      return {
        kind: "call",
        title: runsTitle(result, { shown: "probable", said: "probableSaid" }),
        verb: words.probablyWear.text,
      };
    }
    case "confident": {
      return {
        kind: "call",
        title: runsTitle(result, { shown: "confident", said: "confidentSaid" }),
        verb: words.wearThis.text,
      };
    }
  }
}
