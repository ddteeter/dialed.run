import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BracketHeadline } from "../../src/modules/feed/components/BracketHeadline";

/**
 * `[ NOBODY YET ]` and its waiting twin: pink brackets, which breathe only
 * while something is on its way (the Motion Doctrine's waiting device).
 */
function brackets(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[aria-hidden="true"]')];
}

describe("BracketHeadline", () => {
  it("wears still pink brackets, hidden from a screen reader, by default", () => {
    const { container } = render(<BracketHeadline>Nobody yet</BracketHeadline>);

    expect(screen.getByText("Nobody yet")).toBeVisible();
    // Drawn as a headline, announced as one, under the screen's own h1.
    expect(
      screen.getByRole("heading", { level: 2, name: "Nobody yet" }),
    ).toBeVisible();
    const marks = brackets(container);
    expect(marks.map((mark) => mark.textContent)).toStrictEqual(["[", "]"]);
    for (const mark of marks) {
      expect(mark).toHaveClass("text-action");
      expect(mark).not.toHaveClass("breathe");
    }
    expect(marks[0]).toHaveClass("mr-2");
    expect(marks[1]).toHaveClass("ml-2");
  });

  it("is inline text, so a wrapped headline keeps each bracket on its word (E1-06)", () => {
    render(<BracketHeadline>Finding weather</BracketHeadline>);
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).not.toHaveClass("flex");
    expect(heading).toHaveClass("font-display", "text-display", "uppercase");
    // Brackets and words in one line box, with nothing between them that
    // a line could break at.
    expect(heading.textContent).toBe("[Finding weather]");
    expect(heading.childNodes[1]?.nodeType).toBe(Node.TEXT_NODE);
  });

  it("breathes its brackets, and only its brackets, while pending", () => {
    const { container } = render(
      <BracketHeadline pending>Finding weather</BracketHeadline>,
    );

    const [opening, closing] = brackets(container);
    expect(opening).toHaveClass("breathe", "mr-2", "text-action");
    expect(closing).toHaveClass("breathe", "ml-2", "text-action");
    expect(screen.getByText("Finding weather")).not.toHaveClass("breathe");
  });
});
