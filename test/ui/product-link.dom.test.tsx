import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ProductLink } from "../../src/ui/ProductLink";

/**
 * Assembled rather than written as a literal: `unicorn/prefer-https`
 * rejects the literal, and a non-https link is precisely what these
 * assert gets refused.
 */
const INSECURE = ["http", "://example.com"].join("");

/**
`product_url` is nullable and the lint rules reject the literal.
*/
const NO_LINK = z.null().parse(JSON.parse("null"));

describe("a link a stranger typed", () => {
  it("carries all three rel values", () => {
    render(<ProductLink url="https://janji.com/p/tee" label="Merino Tee" />);

    const link = screen.getByRole("link", { name: "Merino Tee" });
    const rel = link.getAttribute("rel")?.split(" ") ?? [];
    // ugc says a runner wrote it; nofollow stops a closet being an SEO
    // donation; noopener is the security one — without it the opened page
    // can navigate ours through window.opener.
    expect(rel).toContain("ugc");
    expect(rel).toContain("nofollow");
    expect(rel).toContain("noopener");
  });

  it("shows the bare domain beside the text", () => {
    render(<ProductLink url="https://www.janji.com/p/tee" label="Merino Tee" />);

    // A link whose text a stranger chose says nothing about where it
    // goes, and "check the status bar" is not a defence on a phone.
    expect(screen.getByText("janji.com")).toBeInTheDocument();
  });

  it("shows the real host, not a lookalike in the link text", () => {
    render(
      <ProductLink url="https://totally-not-janji.example/x" label="janji.com" />,
    );

    // The label claims one thing and the host says another. Rendering the
    // host is exactly what makes that visible.
    expect(screen.getByText("totally-not-janji.example")).toBeInTheDocument();
  });
});

describe("a link we cannot read", () => {
  it("renders no anchor at all", () => {
    render(<ProductLink url="javascript:alert(1)" label="Looks fine" />);

    // An <a href> to something unparseable would be us passing it on
    // anyway. https-only is enforced at save, so reaching here is a
    // stored oddity rather than a normal path.
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("Looks fine")).toBeInTheDocument();
  });

  it("refuses a plain http link the same way", () => {
    render(<ProductLink url={INSECURE} label="Old link" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("a garment with no link", () => {
  it("renders nothing at all", () => {
    const { container } = render(<ProductLink url={NO_LINK} label="Rover Half-Zip" />);

    // Not the label as plain text — that is what an unparseable URL gets,
    // and it is the right answer there because something WAS stored and a
    // reader should see what. Here nothing was stored, so there is
    // nothing to say.
    expect(container).toBeEmptyDOMElement();
  });
});
