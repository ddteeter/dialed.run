import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ElsewhereHelp } from "../../src/modules/safety/components/ElsewhereHelp";

/**
 * D-147 (design 152): a person asking us to remove an intimate image is
 * pointed to the two services that reach other sites — StopNCII for
 * adults, NCMEC's Take It Down for minors.
 */
describe("ElsewhereHelp", () => {
  it("says where else to go, and why it is safe to", () => {
    render(<ElsewhereHelp />);
    expect(
      document.querySelector("[data-part='elsewhere-help']"),
    ).toHaveTextContent(
      /^If it may be on other sites too, StopNCII\.org \(18 and over\) or Take It Down \(under 18\) can help stop it spreading there\. They fingerprint the image on your own device; the image never leaves it\.$/u,
    );
  });

  it.each([
    ["StopNCII.org", "https://stopncii.org/"],
    ["Take It Down", "https://takeitdown.ncmec.org/"],
  ])("links %s, in a new tab that cannot reach back", (name, href) => {
    render(<ElsewhereHelp />);
    const link = screen.getByRole("link", { name });
    expect(link).toHaveAttribute("href", href);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });
});
