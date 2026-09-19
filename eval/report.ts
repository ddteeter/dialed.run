import type { FabricComposition } from "../src/lib/contracts";
import { knownFibres } from "../src/modules/enrichment/fibres";
import type { Candidate, PageExtractions } from "./extractions";

/**
 * Turning a pile of extractions into something a person can act on.
 *
 * **This used to score the deterministic pass against the models, and that
 * question is closed** (owner, 2026-09-14): the ladder no longer produces a
 * composition at all, so there is nothing left to compare it with. What the
 * eval is for now is the question D-32 asked in the first place — *which
 * model* — and the three things that decide it: how often one finds a
 * composition, whether the models agree when they do, and what they name
 * that is not a fibre.
 *
 * **Still no accuracy score.** That needs ground truth, and treating a
 * model as the oracle would measure how model-like the other models are.
 * Agreement is a fact; accuracy would be an assumption wearing a number.
 */

/**
 * **Finding a composition and structuring it are different capabilities**,
 * and conflating them is the flaw the first two versions of this report
 * had. On SOAR's shorts `gpt-5.6-luna` returned exactly the right verbatim
 * — `Shell 88% PA 12% EL` — and no parsed parts, so a materials count
 * scored it zero and read it as agreeing with a pass that found nothing at
 * all.
 *
 * Verbatim is the load-bearing half: it is what `products.fabric_composition`
 * stores and what D-31 keeps so a better parser can re-read it later. So it
 * is counted first and separately.
 */
export function didFind(composition: FabricComposition | undefined): boolean {
  return composition !== undefined && composition.verbatim.trim() !== "";
}

export function materialCount(
  composition: FabricComposition | undefined,
): number {
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
 * Every material this candidate named that `fibres.ts` does not recognise.
 *
 * **The verification half of the vocabulary**, and the only half left in
 * code. The list is a *hint* in the prompt now rather than a gate in a
 * parser: a model is told what a fibre is, and this reports what it named
 * anyway. `Coreloft™ 80` and `decoration` appearing here is how a person
 * judges whether the hint is working — a gate could only have thrown the
 * answer away.
 *
 * Per candidate rather than per page, so it reads as a property of the
 * model rather than of the shop.
 */
export function unrecognisedIn(candidate: Candidate): string[] {
  const words = new Set<string>();
  const parts = candidate.composition?.parts ?? [];
  for (const part of parts) {
    for (const { material } of part.materials) {
      if (!isKnownFibre(material)) words.add(material.toLowerCase());
    }
  }
  return [...words];
}

interface ModelTally {
  by: string;
  answered: number;
  found: number;
  materials: number;
  unrecognised: Set<string>;
}

function tally(pages: readonly PageExtractions[]): Map<string, ModelTally> {
  const byModel = new Map<string, ModelTally>();
  for (const page of pages) {
    for (const candidate of page.candidates) {
      const seen = byModel.get(candidate.by) ?? {
        by: candidate.by,
        answered: 0,
        found: 0,
        materials: 0,
        unrecognised: new Set<string>(),
      };
      if (candidate.error === undefined) seen.answered += 1;
      if (didFind(candidate.composition)) seen.found += 1;
      seen.materials += materialCount(candidate.composition);
      for (const word of unrecognisedIn(candidate)) seen.unrecognised.add(word);
      byModel.set(candidate.by, seen);
    }
  }
  // The map itself, not a copy of its values: converting trips one unicorn
  // rule for spreading an iterator and the alternative trips another for
  // `Array.from`, while `toArray()` is not in this project's lib target.
  // The caller wants to iterate it once, which a map does natively.
  return byModel;
}

/**
 * The pages where the models do not agree on whether there *is* a
 * composition.
 *
 * The most useful disagreement there is, and the cheapest to adjudicate: a
 * human opens the page and looks. Where they all found one, differences in
 * wording are usually harmless; where one found nothing, somebody is wrong.
 */
function isContested(page: PageExtractions): boolean {
  const answers = page.candidates.filter(
    (candidate) =>
      candidate.by !== "deterministic" && candidate.error === undefined,
  );
  if (answers.length < 2) return false;
  const found = answers.filter((answer) => didFind(answer.composition)).length;
  return found > 0 && found < answers.length;
}

export function reportFor(pages: readonly PageExtractions[]): string {
  const lines: string[] = [
    "# Extraction eval (D-32)",
    "",
    "Generated by `npm run eval`. A model comparison, not a score — see",
    "`eval/report.ts` for why there is no accuracy column.",
    "",
    `${String(pages.length)} pages.`,
    "",
    "## By extractor",
    "",
    "| by | answered | found a composition | materials | named non-fibres |",
    "| --- | --- | --- | --- | --- |",
  ];

  const total = pages.length;
  for (const seen of tally(pages).values()) {
    lines.push(
      `| ${seen.by} | ${String(seen.answered)}/${String(total)} | ${String(seen.found)}/${String(total)} | ${String(seen.materials)} | ${String(seen.unrecognised.size)} |`,
    );
  }

  const split = pages.filter((page) => isContested(page));
  lines.push(
    "",
    "## Contested pages",
    "",
    split.length === 0
      ? "_None: wherever one model found a composition, so did the others._"
      : "One model found a composition and another did not. A person opening the page settles it.",
    "",
  );
  for (const page of split) {
    lines.push(`- ${page.brand} — ${page.category}: <${page.url}>`);
  }

  lines.push("", "## Per page", "");
  for (const page of pages) lines.push(...pageSection(page));
  return lines.join("\n");
}

/**
One page's table, plus what anyone named that is not a fibre we know.
*/
function pageSection(page: PageExtractions): string[] {
  const lines = [
    `### ${page.brand} — ${page.category}`,
    "",
    `<${page.url}>`,
    "",
    `Declared rungs reached: \`${page.rung}\`.`,
    "",
    "| by | found | materials | verbatim |",
    "| --- | --- | --- | --- |",
  ];
  const words = new Set<string>();
  for (const candidate of page.candidates) {
    lines.push(candidateRow(candidate));
    for (const word of unrecognisedIn(candidate)) words.add(word);
  }
  if (words.size > 0) {
    lines.push("", `Named, but not fibres we know: ${[...words].join(", ")}`);
  }
  lines.push("");
  return lines;
}

function candidateRow(candidate: Candidate): string {
  const verbatim =
    candidate.error === undefined
      ? cell(candidate.composition?.verbatim)
      : `_error: ${candidate.error.slice(0, 80)}_`;
  const found = didFind(candidate.composition) ? "yes" : "no";
  const materials = String(materialCount(candidate.composition));
  return `| ${candidate.by} | ${found} | ${materials} | ${verbatim} |`;
}

/**
A verbatim string as one table cell: no newlines, no pipes, not too long.
*/
function cell(verbatim: string | undefined): string {
  if (verbatim === undefined) return "_nothing_";
  // Split and rejoin rather than replace: the replacement is a literal
  // backslash-pipe, and `$` sequences in a replacement string are special.
  const flat = verbatim
    .replaceAll(/\s+/gu, " ")
    .split("|")
    .join(String.raw`\|`);
  return flat.length > 160 ? `${flat.slice(0, 160)}…` : flat;
}
