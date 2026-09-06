import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Icon, ICONS } from "../../src/ui";

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
});
