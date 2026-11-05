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
  });

  it("breathes its brackets, and only its brackets, while pending", () => {
    const { container } = render(
      <BracketHeadline pending>Finding weather</BracketHeadline>,
    );

    for (const mark of brackets(container)) {
      expect(mark).toHaveClass("breathe", "text-action");
    }
    expect(screen.getByText("Finding weather")).not.toHaveClass("breathe");
  });
});
