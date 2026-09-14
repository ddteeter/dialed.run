import { describe, expect, it } from "vitest";

import { pageTextFor } from "../../src/modules/enrichment/model/page-text";

/**
 * What the model is actually shown, on markup real shops actually serve.
 *
 * Each fixture is one text node from a real product page, kept byte-for-byte
 * — entities, JSON escapes, micron grades and all — and nothing else from
 * the page. See `fixtures/MANIFEST.md` for provenance and why so little is
 * stored.
 *
 * **These used to test the prose search, and the prose search is gone**
 * (owner, 2026-09-14 — composition comes from the model rung now). They are
 * not retired with it, because they still pin the step that matters most:
 * the model can only find a composition it is shown, and `pageTextFor` is
 * what decides that. The eval learned this the expensive way — a budget bug
 * sent one page as 2,028 of its 889,578 characters, and the model was
 * recorded as having missed a composition nobody had shown it.
 *
 * So each case asserts the fragment survives the journey into a prompt:
 * decoded, whitespace collapsed, and the composition still legible in it.
 */
/**
 * Inlined by Vite at build time, not read from disk: the workers pool
 * sandboxes the real filesystem, so `readFileSync` cannot reach these — the
 * same reason the architecture tests glob their sources.
 */
const FIXTURES: Record<string, string> = import.meta.glob(
  "./fixtures/*.fragment.html",
  { query: "?raw", import: "default", eager: true },
);

function fixture(name: string): string {
  return FIXTURES[`./fixtures/${name}.fragment.html`] ?? "";
}

describe("the prompt, built from real pages", () => {
  it.each([
    ["ciele-ortshirt", "100% recycled cotton"],
    ["districtvision-cordura-socks", "55% Cotton, 43% Nylon, 2% Polyurethane"],
    ["janji-merino-tee", "47% 17.5μ merino wool"],
    ["pathprojects-shell-jacket", "100% polyester"],
    // The page that made the case for retiring the prose search: three
    // labelled sections, of which it found one.
    ["rabbit-chaser-track-pant", "91% recycled polyester"],
    ["rabbit-chaser-track-pant", "82% polyester, 15% cotton"],
    ["rabbit-chaser-track-pant", "88% polyester"],
    ["satisfy-mothtech-tee", "100% organic cotton"],
    ["soar-wooltech-half-tights", "24% merino wool"],
  ])("%s: the prompt still carries %s", (name, composition) => {
    expect(pageTextFor(fixture(name))).toContain(composition);
  });

  it("decodes entities, so the model is not asked to copy them", () => {
    // The rabbit fragment carries `&amp;` — double-encoded, through
    // JSON, inside an attribute. Shown that, the model copied it into
    // `verbatim` character for character, exactly as instructed to.
    const prompt = pageTextFor(fixture("rabbit-chaser-track-pant"));
    expect(prompt).toContain("recycled polyester & 9% spandex");
    expect(prompt).not.toContain("&amp;");
  });

  it("carries the composition a shop wrote in abbreviations", () => {
    // `Shell 88% PA 12% EL`. The prose search read nothing here, because
    // `fibres.ts` knows `polyamide` and `elastane` but not `PA` and `EL` —
    // one of the two failures that retired it. A prompt has no vocabulary
    // to be missing, so the text simply has to arrive.
    expect(pageTextFor(fixture("soar-run-shorts"))).toContain("88% PA 12% EL");
  });
});
