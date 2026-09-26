import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Bracketed } from "../../src/ui/Bracketed";
import { Icon } from "../../src/ui/icons";
import { Mono } from "../../src/ui/Mono";
import { Skeleton } from "../../src/ui/Skeleton";
import { Wordmark } from "../../src/ui/Wordmark";

/**
 * The small primitives, where the class *is* the contract.
 *
 * Most class strings in this codebase are decoration and stryker does not
 * mutate them at all — a plain `className="..."` JSX attribute produces no
 * mutant. The ones that do survive are the handful held in a const or
 * built in an expression, and in these files that is not incidental: `Mono`
 * exists to say "a sensor produced this number, not a person", and
 * `Bracketed` applies `uppercase` in CSS rather than in the string
 * precisely so the accessible name stays in normal case. Asserting those
 * classes is asserting the documented behaviour, not pinning a look.
 */

describe("Mono", () => {
  it("renders in the mono face — that is the whole point of it", () => {
    render(<Mono>4:52</Mono>);
    // Mono is the tell that a value was measured (docs/product.md §Brand).
    // Without the class it is prose in a mono-shaped hole.
    expect(screen.getByText("4:52")).toHaveClass("font-mono");
  });

  it("keeps its own classes when the caller adds one", () => {
    render(<Mono className="text-cold-text">4:52</Mono>);
    const value = screen.getByText("4:52");
    expect(value).toHaveClass("font-mono");
    expect(value).toHaveClass("text-cold-text");
  });

  it("reaches each rung of the ramp, and only through the step", () => {
    // The ramp is four steps and four trackings (tokens.js MONO). One
    // hardcoded treatment is what sent 17 call sites off to write their
    // own `font-mono text-[11px] tracking-[0.1em]`, so a step has to be
    // addressable — and the size utility is what carries the tracking,
    // which is why there is no second class here to get wrong.
    for (const [step, size] of [
      ["xs", "text-mono-xs"],
      ["sm", "text-mono-sm"],
      ["md", "text-mono-md"],
      ["lg", "text-mono-lg"],
    ] as const) {
      const { unmount } = render(<Mono step={step}>4:52</Mono>);
      expect(screen.getByText("4:52")).toHaveClass(size);
      unmount();
    }
  });

  it("shouts at xs and sm, and stays mixed case at md and lg", () => {
    // MONO's own rule: "Uppercase is allowed at xs and sm only." md and lg
    // sit inside prose and in the data strip, where a shouted value would
    // be the loudest thing on the screen.
    for (const step of ["xs", "sm"] as const) {
      const { unmount } = render(<Mono step={step}>dialed</Mono>);
      expect(screen.getByText("dialed")).toHaveClass("uppercase");
      unmount();
    }
    for (const step of ["md", "lg"] as const) {
      const { unmount } = render(<Mono step={step}>dialed</Mono>);
      expect(screen.getByText("dialed")).not.toHaveClass("uppercase");
      unmount();
    }
  });

  it("defaults to sm, which is what the call sites asked for", () => {
    // Not an arbitrary default: `sm` is the step 10 of the 17 bypasses
    // spelled out at 11px, and it is the one that keeps `Bracketed`
    // uppercase — which Bracketed's own contract depends on.
    render(<Mono>4:52</Mono>);
    expect(screen.getByText("4:52")).toHaveClass("text-mono-sm");
    expect(screen.getByText("4:52")).toHaveClass("uppercase");
  });
});

describe("Bracketed", () => {
  it("renders the brackets around the value", () => {
    const { container } = render(<Bracketed>8 of 9</Bracketed>);
    expect(container.firstElementChild).toHaveTextContent("[8 of 9]");
  });

  it("shouts in CSS, not in the string", () => {
    // The accessible name stays in normal case on purpose: several screen
    // readers spell short all-caps tokens out letter by letter, having no
    // way to tell a shouted word from an initialism. So the uppercase is a
    // class, and the text node is what a reader announces.
    const { container } = render(<Bracketed>Indoor</Bracketed>);
    const span = container.firstElementChild;
    expect(span?.textContent).toBe("[Indoor]");
    // The uppercase comes from Mono, which Bracketed composes rather than
    // restating — it used to apply its own and they were the same fact
    // written twice.
    expect(span).toHaveClass("uppercase");
    expect(span).toHaveClass("font-mono");
  });

  it("carries the step through to the ramp", () => {
    // Without this, `<Bracketed step="lg">` would render at `sm` and the
    // data strip would be 11px with nothing failing.
    render(<Bracketed step="lg">38–46°</Bracketed>);
    expect(screen.getByText(/38–46°/)).toHaveClass("text-mono-lg");
  });

  it("keeps the uppercase when the caller adds a class of their own", () => {
    // The two arms of the same decision: a caller-supplied class must not
    // displace the one this component exists to apply.
    const { container } = render(
      <Bracketed className="text-cold-text">Indoor</Bracketed>,
    );
    const span = container.firstElementChild;
    expect(span).toHaveClass("uppercase");
    expect(span).toHaveClass("text-cold-text");
  });
});

describe("Wordmark", () => {
  it("renders the lockup lowercase, with pink brackets", () => {
    const { container } = render(<Wordmark />);
    const lockup = container.firstElementChild;
    expect(lockup).toHaveTextContent("[dialed.run]");
    // Lowercase always, including sentence-initial — a class, so the text
    // itself is already lowercase and cannot be shouted by a caller.
    expect(lockup).toHaveClass("lowercase");
    expect(screen.getAllByText("[")).toHaveLength(1);
    expect(screen.getByText("[")).toHaveClass("text-cold-text");
    expect(screen.getByText("]")).toHaveClass("text-cold-text");
  });

  it("drops the brackets for the plain lockup the signed-out bars draw", () => {
    // Round 21's landing bar and the Auth board set "dialed" + ".run" and
    // nothing else — "pink stays off this bar", and the brackets are the
    // lockup's only pink.
    const { container } = render(<Wordmark brackets={false} />);
    expect(container.firstElementChild).toHaveTextContent(/^dialed\.run$/u);
    expect(screen.queryByText("[")).toBeNull();
    expect(screen.queryByText("]")).toBeNull();
    expect(screen.getByText(".run")).toHaveClass("text-muted");
  });

  it("keeps the lockup classes when the caller adds one", () => {
    const { container } = render(<Wordmark className="text-title" />);
    const lockup = container.firstElementChild;
    expect(lockup).toHaveClass("lowercase");
    expect(lockup).toHaveClass("text-title");
  });
});

describe("Skeleton", () => {
  it("is hidden from assistive tech and sized by its caller", () => {
    // A loading block announced as "blank" is worse than silence.
    const { container } = render(<Skeleton className="h-4 w-24" />);
    const block = container.firstElementChild;
    expect(block).toHaveAttribute("aria-hidden", "true");
    expect(block).toHaveClass("h-4");
    expect(block).toHaveClass("w-24");
  });
});

describe("Icon", () => {
  it("is decorative by default: hidden, and carries no role to announce", () => {
    // Both halves, and the attribute rather than the role query: an
    // `aria-hidden` element is outside the accessibility tree whatever its
    // role says, so `queryByRole` cannot tell a missing role from a hidden
    // one — and a stray `role="img"` with no name is exactly what a reader
    // would stop on if the hiding were ever removed.
    const { container } = render(<Icon name="bell" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).not.toHaveAttribute("role");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("becomes an image with a name when it is given a label", () => {
    // `role="img"` only when there is something to announce — a role with
    // no name is a node a reader stops on and cannot describe.
    render(<Icon name="bell" label="Notifications" />);
    const icon = screen.getByRole("img", { name: "Notifications" });
    expect(icon).toHaveAttribute("role", "img");
    expect(icon).not.toHaveAttribute("aria-hidden");
  });
});
