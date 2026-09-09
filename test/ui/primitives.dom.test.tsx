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
    render(<Mono className="text-pink">4:52</Mono>);
    const value = screen.getByText("4:52");
    expect(value).toHaveClass("font-mono");
    expect(value).toHaveClass("text-pink");
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

  it("keeps the uppercase when the caller adds a class of their own", () => {
    // The two arms of the same decision: a caller-supplied class must not
    // displace the one this component exists to apply.
    const { container } = render(
      <Bracketed className="text-pink">Indoor</Bracketed>,
    );
    const span = container.firstElementChild;
    expect(span).toHaveClass("uppercase");
    expect(span).toHaveClass("text-pink");
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
    expect(screen.getByText("[")).toHaveClass("text-pink");
    expect(screen.getByText("]")).toHaveClass("text-pink");
  });

  it("keeps the lockup classes when the caller adds one", () => {
    const { container } = render(<Wordmark className="text-2xl" />);
    const lockup = container.firstElementChild;
    expect(lockup).toHaveClass("lowercase");
    expect(lockup).toHaveClass("text-2xl");
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
