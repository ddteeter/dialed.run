/**
 * Two versions' replay side by side, as plain text for a PR body. Returns
 * the text; writing it anywhere is the caller's business.
 */
import type { Confidence } from "../contract";
import type { Comparison } from "./compare";
import {
  byRank,
  rate,
  type ConfidenceSplit,
  type DirectionShare,
  type ReplayMetrics,
  type Share,
} from "./metrics";

export interface VersionMetrics {
  engineVersion: string;
  metrics: ReplayMetrics;
}

const LABEL_WIDTH = 36;
const COLUMN_WIDTH = 30;

function shareText(share: Share): string {
  const value = rate(share);
  const percent = value === undefined ? "—" : `${(value * 100).toFixed(1)}%`;
  return `${percent} (${String(share.hits)}/${String(share.of)})`;
}

function directionText(share: DirectionShare): string {
  return `${shareText(share)} +${String(share.noCall)} no call`;
}

function row(label: string, cells: readonly string[]): string {
  return [
    label.padEnd(LABEL_WIDTH),
    ...cells.map((c) => c.padEnd(COLUMN_WIDTH)),
  ]
    .join("")
    .trimEnd();
}

const EMPTY_SPLIT: ConfidenceSplit = {
  dialedAgreement: { hits: 0, of: 0 },
  direction: { hits: 0, of: 0, noCall: 0 },
};

function confidenceRows(
  baseline: ReplayMetrics,
  candidate: ReplayMetrics,
): string[] {
  const splitFor = (m: ReplayMetrics, confidence: Confidence) =>
    m.byConfidence.find((r) => r.confidence === confidence) ?? EMPTY_SPLIT;
  const used = new Set<Confidence>(
    [...baseline.byConfidence, ...candidate.byConfidence].map(
      (r) => r.confidence,
    ),
  );
  return [...used].toSorted(byRank).flatMap((confidence) => {
    const before = splitFor(baseline, confidence);
    const after = splitFor(candidate, confidence);
    return [
      row(`${confidence} · dialed agreement`, [
        shareText(before.dialedAgreement),
        shareText(after.dialedAgreement),
      ]),
      row(`${confidence} · direction`, [
        directionText(before.direction),
        directionText(after.direction),
      ]),
    ];
  });
}

export function formatReport(
  baseline: VersionMetrics,
  candidate: VersionMetrics,
  comparison: Comparison,
): string {
  const before = baseline.metrics;
  const after = candidate.metrics;
  const verdicts = new Map(
    comparison.metrics.map((m) => [m.metric, m.verdict] as const),
  );
  const lines = [
    row("measure", [
      baseline.engineVersion,
      candidate.engineVersion,
      "verdict",
    ]),
    row("cases", [String(before.cases), String(after.cases)]),
    row("coverage", [shareText(before.coverage), shareText(after.coverage)]),
    row("dialed agreement", [
      shareText(before.dialedAgreement),
      shareText(after.dialedAgreement),
      verdicts.get("dialedAgreement") ?? "",
    ]),
    row("direction on misses", [
      directionText(before.direction),
      directionText(after.direction),
      verdicts.get("direction") ?? "",
    ]),
    ...confidenceRows(before, after),
    `release check (tolerance ${String(comparison.tolerance)}): ${comparison.pass ? "PASS" : "FAIL"}`,
  ];
  return lines.join("\n");
}
