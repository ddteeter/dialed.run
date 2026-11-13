import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WeatherAttribution } from "../../src/ui";

/**
 * Visual Crossing's licence: *"prominently display the message 'Weather
 * Data Provided by Visual Crossing' in a legible manner near the data …
 * with a clickable link to https://www.visualcrossing.com/"*. The owner
 * chose the sentence-case wording (D-144). These pin the copy and the link
 * literally, because a reworded credit is a licence breach that renders
 * fine; every conditions surface's own test then asks for this link by
 * this name.
 */
describe("WeatherAttribution (D-144)", () => {
  it("says the licence's sentence, as a link to Visual Crossing's home page", () => {
    render(<WeatherAttribution />);

    const link = screen.getByRole("link", {
      name: "Weather data provided by Visual Crossing",
    });
    expect(link).toHaveAttribute("href", "https://www.visualcrossing.com/");
  });

  it("draws the card's label, heard by the same sentence, at the same address (Round 54 · 170)", () => {
    const { unmount } = render(<WeatherAttribution />);
    const sentence = screen.getByRole("link");
    const href = sentence.getAttribute("href");
    expect(sentence).toHaveClass("text-micro", "text-muted", "no-underline");
    expect(sentence).toHaveAttribute("data-target", "inline");
    expect(sentence).not.toHaveAttribute("aria-label");
    unmount();

    render(<WeatherAttribution isCompact />);
    const label = screen.getByRole("link", {
      name: "Weather data provided by Visual Crossing",
    });
    expect(label).toHaveAttribute("href", href);
    expect(label).toHaveAttribute("target", "_blank");
    // The drawn words are the end of the name it is heard by (WCAG 2.5.3).
    expect(label).toHaveTextContent(/^Visual Crossing$/u);
    // MONO.xs, muted, underlined, never wrapped, in a 44 target.
    expect(label).toHaveClass(
      "target",
      "font-mono",
      "text-mono-xs",
      "uppercase",
      "text-muted",
      "underline",
      "whitespace-nowrap",
    );
    expect(label).not.toHaveAttribute("data-target");
  });

  it("keeps a repeated card label drawn and unheard, with no name", () => {
    render(<WeatherAttribution isCompact isRepeat />);
    const drawn = screen.getByText("Visual Crossing");
    expect(drawn).toHaveAttribute("aria-hidden", "true");
    expect(drawn).toHaveAttribute("tabindex", "-1");
    expect(drawn).not.toHaveAttribute("aria-label");
  });

  it("opens in a new tab without handing the page its opener", () => {
    render(<WeatherAttribution />);

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("target", "_blank");
    const rel = link.getAttribute("rel")?.split(" ") ?? [];
    expect(rel).toContain("noopener");
    expect(rel).toContain("noreferrer");
  });

  it("is heard and reached by Tab unless it repeats one already said (R-179)", () => {
    const { unmount } = render(<WeatherAttribution />);
    const heard = screen.getByRole("link");
    expect(heard).not.toHaveAttribute("aria-hidden");
    expect(heard).not.toHaveAttribute("tabindex");
    unmount();

    render(<WeatherAttribution isRepeat />);
    // Still drawn, as the licence asks; out of the tree and the Tab order.
    const drawn = screen.getByText("Weather data provided by Visual Crossing");
    expect(drawn).toBeVisible();
    expect(drawn).toHaveAttribute("aria-hidden", "true");
    expect(drawn).toHaveAttribute("tabindex", "-1");
    expect(screen.queryByRole("link")).toBeNull();
  });
});
