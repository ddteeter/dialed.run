import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

// The design handoff itself. Inlined by Vite at build time — the workers
// pool sandboxes the real filesystem, and design/ is excluded from tsc
// anyway, so the bytes are all we want.
import iconPackSource from "../../design/icons.js?raw";

import { Icon, ICONS, TAB_BAR } from "../../src/ui";

describe("Icon (design icon pack contract)", () => {
  it("renders the manifest path as a monoline stroke glyph", () => {
    const markup = renderToStaticMarkup(<Icon name="bell" />);
    expect(markup).toContain(`d="${ICONS.bell.d}"`);
    expect(markup).toContain('fill="none"');
    expect(markup).toContain('stroke="currentColor"');
    expect(markup).toContain('stroke-linecap="square"');
    expect(markup).toContain('stroke-linejoin="miter"');
  });

  it("scales stroke width by size per the pack rules", () => {
    expect(renderToStaticMarkup(<Icon name="add" size={16} />)).toContain(
      'stroke-width="1.5"',
    );
    expect(renderToStaticMarkup(<Icon name="add" />)).toContain(
      'stroke-width="1.75"',
    );
    expect(renderToStaticMarkup(<Icon name="add" size={28} />)).toContain(
      'stroke-width="2"',
    );
  });

  it("is hidden from AT unless labelled", () => {
    expect(renderToStaticMarkup(<Icon name="warning" />)).toContain(
      'aria-hidden="true"',
    );
    const labelled = renderToStaticMarkup(
      <Icon name="warning" label="Something needs attention" />,
    );
    expect(labelled).toContain('role="img"');
    expect(labelled).toContain('aria-label="Something needs attention"');
    expect(labelled).not.toContain("aria-hidden");
  });

  it("carries the five bracketed verdict glyphs the brand requires", () => {
    const bracketStroke = "M6 3H3v18h3M18 3h3v18h-3";
    for (const name of [
      "verdictDialed",
      "verdictCold",
      "verdictWarm",
      "verdictMixed",
      "verdictPending",
    ] as const) {
      expect(ICONS[name].d).toContain(bracketStroke);
    }
  });

  it("matches design/icons.js glyph for glyph", () => {
    // `src/ui/icons.tsx` is a hand-maintained port of the design pack, which
    // is the mirror-instead-of-derive shape CLAUDE.md warns about: two
    // copies of one truth, and nothing to make them disagree loudly. It
    // cannot be derived — the pack is untyped JS in a read-only archive —
    // so this pins it instead. Import a new pack revision and this test
    // tells you exactly which glyphs moved.
    const declared = new Map<string, { group: string; d: string }>();
    const declaredNames: string[] = [];
    const entry =
      /^ {2}([A-Za-z][A-Za-z0-9]*): \{ group: '([a-z]+)', keywords: '[^']*', d: '([^']*)' \},$/gm;
    for (const match of iconPackSource.matchAll(entry)) {
      const [, name, group, d] = match;
      if (name === undefined || group === undefined || d === undefined) continue;
      declared.set(name, { group, d });
      declaredNames.push(name);
    }

    // A parser that silently matches nothing would make every assertion
    // below vacuous.
    expect(declared.size).toBeGreaterThan(70);
    const ported = new Set(Object.keys(ICONS));
    expect(declaredNames.filter((name) => !ported.has(name))).toEqual([]);
    expect(Object.keys(ICONS).filter((name) => !declared.has(name))).toEqual([]);
    for (const [name, glyph] of Object.entries(ICONS)) {
      expect({ name, ...glyph }).toEqual({ name, ...declared.get(name) });
    }
  });

  it("resolves all five tabs to a glyph the pack defines", () => {
    // The gap this closes: the pack's nav group is four glyphs and the tab
    // bar is five tabs, so lanes were guessing at Call.
    expect(TAB_BAR).toHaveLength(5);
    for (const { icon } of TAB_BAR) expect(ICONS[icon]).toBeDefined();
    expect(TAB_BAR.find((t) => t.tab === "Call")?.icon).toBe("verdictPending");
  });
});
