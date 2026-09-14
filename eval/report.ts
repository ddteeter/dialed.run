import type { FabricComposition } from "../src/lib/contracts";
import { knownFibres } from "../src/modules/enrichment/fibres";
import type { PageExtractions } from "./extractions";

/**
 * Turning a pile of extractions into something a person can act on.
 *
 * **No accuracy score, deliberately.** Scoring needs ground truth, and
 * there is none yet — inventing one by treating a model as the oracle
 * would measure how model-like the deterministic pass is, which is not the
 * goal. What this reports instead is *disagreement*, which is a fact, plus
 * the shape of each disagreement so a human can adjudicate it in minutes.
 */

export function materialCount(composition: FabricComposition | undefined): number {
  return (composition?.parts ?? []).reduce(
    (total, part) => total + part.materials.length,
    0,
  );
}

/**
 * Does any word of this material name a fibre the vocabulary knows?
 *
 * Matched on a word rather than the whole string, because a fibre arrives
 * with qualifiers attached — "recycled polyester", "17.5μ merino wool".
 */
function isKnownFibre(material: string): boolean {
  const known = new Set<string>(knownFibres());
  for (const [word] of material.toLowerCase().matchAll(/\p{Letter}+/gu)) {
    if (known.has(word)) return true;
  }
  return false;
}

/**
 * Every material named by anyone, that `fibres.ts` does not recognise.
 *
 * **This is the verification half of the vocabulary**, and the only half
 * left in code. The list is a *hint* in the prompt now, not a gate in the
 * parser (2026-09-14): a model is told what a fibre is, and this reports
 * what it named anyway. Seeing `Coreloft™ 80` or `decoration` in this
 * column is how a person judges whether the hint is working — a gate could
 * only have thrown the answer away.
 */
export function unrecognised(page: PageExtractions): string[] {
  const words = new Set<string>();
  for (const candidate of page.candidates) {
    const parts = candidate.composition?.parts ?? [];
    for (const part of parts) {
      for (const { material } of part.materials) {
        if (!isKnownFibre(material)) words.add(material.toLowerCase());
      }
    }
  }
  // Insertion order, not sorted: the candidates are visited in a fixed
  // order, so this is already deterministic, and `toSorted` is not in this
  // project's lib target while `sort` trips the no-mutation rule.
  return [...words];
}

export type Verdict =
  | "agreed"
  | "deterministic-found-nothing"
  | "deterministic-found-less"
  | "deterministic-found-more"
  | "no-model-answer";

/**
 * How the deterministic pass compares to the models.
 *
 * **Against the models' *consensus*, not against the best of them**, and
 * the first version got this wrong in a way worth recording. It scored
 * against `Math.max(materials)` across the models, which rewards a model
 * for over-counting: on the Icebreaker page one model read the legal
 * disclaimer "Exclusive of decoration" as a second material, and that
 * inflated count marked a correct deterministic answer as a failure. A
 * metric that treats "found more" as "better" will always be gamed by the
 * least careful participant.
 *
 * The median is the consensus here — with two or three models it is the
 * middle answer, which needs a majority to move rather than one outlier.
 *
 * **Material count is the comparison, not string equality.** The verbatim
 * strings differ harmlessly all the time — one pass keeps the "Fabric:"
 * label the other drops — where a materials count that differs means one of
 * them is missing a *section* of the garment, which is the failure that
 * matters.
 */
export function verdictFor(page: PageExtractions): Verdict {
  const deterministic = page.candidates.find(
    (candidate) => candidate.by === "deterministic",
  );
  const answers = page.candidates.filter(
    (candidate) => candidate.by !== "deterministic" && candidate.error === undefined,
  );
  if (answers.length === 0) return "no-model-answer";

  const mine = materialCount(deterministic?.composition);
  const theirs = median(answers.map((answer) => materialCount(answer.composition)));
  if (mine === 0 && theirs > 0) return "deterministic-found-nothing";
  if (mine < theirs) return "deterministic-found-less";
  if (mine > theirs) return "deterministic-found-more";
  return "agreed";
}

/**
The middle value, or the lower of the two middles for an even count.
*/
function median(values: readonly number[]): number {
  // Counted rather than sorted: `toSorted` is not in this project's lib
  // target and `sort` trips the no-mutation rule, and the median of a
  // handful of small integers is answerable by walking them.
  let middle = 0;
  for (const candidate of values) {
    const below = values.filter((value) => value < candidate).length;
    const atOrBelow = values.filter((value) => value <= candidate).length;
    const half = (values.length - 1) / 2;
    if (below <= half && half < atOrBelow) middle = candidate;
  }
  return middle;
}

const VERDICT_NOTE: Record<Verdict, string> = {
  agreed: "same number of materials as the models' consensus",
  "deterministic-found-nothing": "**found nothing** where the models found some",
  "deterministic-found-less": "**found fewer materials** than the consensus",
  "deterministic-found-more": "found more materials than the consensus",
  "no-model-answer": "no model answered; nothing to compare against",
};

export function reportFor(pages: readonly PageExtractions[]): string {
  const lines: string[] = [
    "# Extraction eval (D-32)",
    "",
    "Generated by `npm run eval`. Not a score — a disagreement report; see",
    "`eval/report.ts` for why there is no accuracy column yet.",
    "",
    "## Summary",
    "",
    "| verdict | pages |",
    "| --- | --- |",
  ];

  const verdicts = pages.map((page) => verdictFor(page));
  for (const verdict of Object.keys(VERDICT_NOTE) as Verdict[]) {
    const count = verdicts.filter((seen) => seen === verdict).length;
    if (count > 0) lines.push(`| ${verdict} | ${String(count)} |`);
  }

  lines.push("", "## Per page", "");
  for (const [index, page] of pages.entries()) {
    lines.push(
      `### ${page.brand} — ${page.category}`,
      "",
      `<${page.url}>`,
      "",
      `Deterministic rung: \`${page.rung}\`. Verdict: ${VERDICT_NOTE[verdicts[index] ?? "agreed"]}.`,
      "",
      "| by | materials | verbatim |",
      "| --- | --- | --- |",
    );
    for (const candidate of page.candidates) {
      const verbatim =
        candidate.error === undefined
          ? cell(candidate.composition?.verbatim)
          : `_error: ${candidate.error.slice(0, 80)}_`;
      lines.push(
        `| ${candidate.by} | ${String(materialCount(candidate.composition))} | ${verbatim} |`,
      );
    }
    const words = unrecognised(page);
    if (words.length > 0) {
      lines.push("", `Materials \`fibres.ts\` does not know: ${words.join(", ")}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/**
A verbatim string as one table cell: no newlines, no pipes, not too long.
*/
function cell(verbatim: string | undefined): string {
  if (verbatim === undefined) return "_nothing_";
  // Split and rejoin rather than replace: the replacement is a literal
  // backslash-pipe, and `$` sequences in a replacement string are special.
  const flat = verbatim.replaceAll(/\s+/gu, " ").split("|").join(String.raw`\|`);
  return flat.length > 160 ? `${flat.slice(0, 160)}…` : flat;
}
