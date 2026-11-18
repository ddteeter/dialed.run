import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ElsewhereHelp } from "../../src/modules/safety/components/ElsewhereHelp";

/**
 * D-147 (round 41 #85): a person asking us to remove an intimate image is
 * pointed to the two services that reach other sites — StopNCII for
 * adults, NCMEC's Take It Down for minors, by the age of the person in it
 * when it was taken.
 */
describe("ElsewhereHelp", () => {
  it("says where else to go, and why it is safe to", () => {
    render(<ElsewhereHelp />);
    const line = document.querySelector("[data-part='elsewhere-help']");
    // The text a screen reader hears is the text on screen: no hidden
    // words ride along (D-187).
    expect(line).toHaveTextContent(
      /^If it's on other sites too, these free services can help stop it spreading: StopNCII\.org if the person in it was 18 or over when it was taken, Take It Down if they were under 18\. Each makes a fingerprint of the image on your own device; the image never leaves it\.$/u,
    );
  });

  it("is a quiet small line under a hairline", () => {
    render(<ElsewhereHelp />);
    const line = document.querySelector("[data-part='elsewhere-help']");
    expect(line).toHaveClass(
      "text-small",
      "text-quiet",
      "border-t",
      "border-hairline",
    );
  });

  it.each([
    ["StopNCII.org", "https://stopncii.org/"],
    ["Take It Down", "https://takeitdown.ncmec.org/"],
  ])(
    "links %s, named by its visible words, in the same tab, with no referrer",
    (name, href) => {
      render(<ElsewhereHelp />);
      const link = screen.getByRole("link", { name });
      expect(link).toHaveAccessibleName(name);
      expect(link).toHaveAttribute("href", href);
      expect(link).not.toHaveAttribute("target");
      expect(link).toHaveAttribute("rel", "noreferrer");
      expect(link).toHaveClass("font-bold", "text-ink", "underline");
      expect(link.querySelector(".sr-only")).toBeNull();
    },
  );
});
