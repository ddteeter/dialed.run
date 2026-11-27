import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { WhyNots } from "../../../src/modules/call/screen/components/WhyNots";
import { violations } from "../../ui/axe";
import { drawnFrom, probableCall } from "./fixtures";

/**
 * B2's why-nots (Round 62, 365): up to three disclosure rows in group
 * order, one open at a time, the rest behind "▸ N more".
 */
const QUESTIONS = [
  "Why not the tee?",
  "Why not the shorts?",
  "Why not the vest?",
  "Why not the gloves?",
  "Why not the racers?",
];

function rows(count = QUESTIONS.length) {
  return drawnFrom(probableCall()).facts.whyNots.slice(0, count);
}

/**
 * The question's button, by its place in `QUESTIONS`.
 */
function question(index: number): HTMLElement {
  return screen.getByRole("button", { name: QUESTIONS[index] ?? "no such" });
}

/**
 * The questions on the page in order, each with whether it is open.
 */
function disclosures(): [string | null, string | null][] {
  return screen
    .getAllByRole("button", { name: /^Why not/u })
    .map((button) => [
      button.textContent,
      button.getAttribute("aria-expanded"),
    ]);
}

function answerOf(button: HTMLElement): HTMLElement {
  const id = button.getAttribute("aria-controls") ?? "";
  const answer = document.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
  if (!(answer instanceof HTMLElement)) {
    throw new TypeError("the question controls nothing");
  }
  return answer;
}

describe("the why-nots", () => {
  it("shows the first three in the order given, closed, and folds the rest", () => {
    render(<WhyNots rows={rows()} />);

    expect(disclosures()).toStrictEqual([
      ["Why not the tee?+", "false"],
      ["Why not the shorts?+", "false"],
      ["Why not the vest?+", "false"],
    ]);
    expect(screen.getByRole("button", { name: "2 more" }).textContent).toBe(
      "▸2 more",
    );
  });

  it("heads them with the caption, typed in sentence case", () => {
    render(<WhyNots rows={rows()} />);

    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(
      "Why not",
    );
  });

  it("keeps each answer in the page, hidden until its question is opened", () => {
    render(<WhyNots rows={rows()} />);
    const answer = answerOf(question(2));

    expect(answer.textContent).toBe(
      "Nothing in your verdicts says you need the vest at this hour.",
    );
    expect(answer).not.toBeVisible();
    expect(answer.tagName).toBe("P");
  });

  it("opens a question to its own answer and draws the open mark", async () => {
    const user = userEvent.setup();
    render(<WhyNots rows={rows()} />);

    await user.click(question(2));

    expect(disclosures()).toStrictEqual([
      ["Why not the tee?+", "false"],
      ["Why not the shorts?+", "false"],
      ["Why not the vest?−", "true"],
    ]);
    expect(answerOf(question(2))).toBeVisible();
    expect(answerOf(question(0))).not.toBeVisible();
  });

  it("keeps one open at a time: opening another closes the first", async () => {
    const user = userEvent.setup();
    render(<WhyNots rows={rows()} />);

    await user.click(question(2));
    await user.click(question(0));

    expect(disclosures().map(([, isOpen]) => isOpen)).toStrictEqual([
      "true",
      "false",
      "false",
    ]);
    expect(answerOf(question(0))).toBeVisible();
    expect(answerOf(question(0)).textContent).toBe(
      "The Merino half-zip is dialed 8 of 9 in this band. The tee has no verdicts here yet.",
    );
    expect(answerOf(question(2))).not.toBeVisible();
  });

  it("closes the open question when it is pressed again", async () => {
    const user = userEvent.setup();
    render(<WhyNots rows={rows()} />);

    await user.click(question(1));
    await user.click(question(1));

    expect(disclosures().map(([, isOpen]) => isOpen)).toStrictEqual([
      "false",
      "false",
      "false",
    ]);
    expect(answerOf(question(1))).not.toBeVisible();
  });

  it("hides the marks from a screen reader, which hears the state", () => {
    render(<WhyNots rows={rows()} />);

    expect(question(0)).toHaveAccessibleName("Why not the tee?");
    expect(
      [...document.querySelectorAll("[aria-hidden='true']")].map(
        (mark) => mark.textContent,
      ),
    ).toStrictEqual(["+", "+", "+", "▸"]);
  });

  it("moves no focus when it first draws", () => {
    render(<WhyNots rows={rows()} />);

    expect(document.body).toHaveFocus();
  });

  it("reveals the rest on N more, which goes, and moves focus to the first row revealed", async () => {
    const user = userEvent.setup();
    render(<WhyNots rows={rows()} />);

    await user.click(question(0));
    await user.click(screen.getByRole("button", { name: "2 more" }));

    expect(disclosures()).toStrictEqual([
      ["Why not the tee?−", "true"],
      ["Why not the shorts?+", "false"],
      ["Why not the vest?+", "false"],
      ["Why not the gloves?+", "false"],
      ["Why not the racers?+", "false"],
    ]);
    expect(screen.queryByRole("button", { name: /more$/u })).toBeNull();
    expect(question(3)).toHaveFocus();
  });

  it("opens a revealed row like any other, still one at a time", async () => {
    const user = userEvent.setup();
    render(<WhyNots rows={rows()} />);

    await user.click(question(0));
    await user.click(screen.getByRole("button", { name: "2 more" }));
    await user.click(question(4));

    expect(disclosures().map(([, isOpen]) => isOpen)).toStrictEqual([
      "false",
      "false",
      "false",
      "false",
      "true",
    ]);
    // Opening a row re-draws the list; the focus stays where the press put it.
    expect(question(4)).toHaveFocus();
  });

  it("counts what is folded: one more with four", () => {
    render(<WhyNots rows={rows(4)} />);

    expect(screen.getByRole("button", { name: "1 more" })).toBeInTheDocument();
  });

  it("folds nothing with three, and draws no more-button over nothing", () => {
    render(<WhyNots rows={rows(3)} />);

    expect(disclosures()).toHaveLength(3);
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("draws nothing at all with no why-not", () => {
    const { container } = render(<WhyNots rows={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("has nothing axe objects to, closed or open", async () => {
    const user = userEvent.setup();
    const { container } = render(<WhyNots rows={rows()} />);

    expect(await violations(container)).toStrictEqual([]);
    await user.click(question(0));
    expect(await violations(container)).toStrictEqual([]);
  });
});
