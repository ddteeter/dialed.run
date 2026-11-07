import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OnboardingShell } from "../../src/ui/OnboardingShell";

/**
 * The shell an onboarding step wears (round 49, R49·138a): below 1040
 * nothing but the step's `<main>`, and from 1040 a bar that shows only
 * the wordmark, "since there's still nowhere to go".
 */
describe("OnboardingShell", () => {
  it("is the page's one main, inside the page measure", () => {
    render(<OnboardingShell>step</OnboardingShell>);

    const main = screen.getByRole("main");
    expect(main).toHaveTextContent("step");
    expect(main).toHaveClass("mx-auto", "w-full", "max-w-page", "flex-1");
    expect(main.parentElement).toHaveClass(
      "flex",
      "min-h-dvh",
      "flex-col",
      "bg-ground",
      "text-ink",
    );
  });

  it("shows its bar only from 1040, with a hairline foot", () => {
    render(<OnboardingShell>step</OnboardingShell>);

    const bar = screen.getByRole("banner");
    expect(bar).toHaveClass(
      "hidden",
      "desk:block",
      "border-b",
      "border-hairline",
      "px-6",
      "py-4",
    );
    expect(bar).not.toHaveClass("wide:block");
    expect(bar.firstElementChild).toHaveClass(
      "mx-auto",
      "flex",
      "min-h-11",
      "w-full",
      "max-w-page",
      "items-center",
    );
  });

  it("puts only the wordmark on the bar: no tabs, no links, nowhere to go", () => {
    render(<OnboardingShell>step</OnboardingShell>);

    const bar = screen.getByRole("banner");
    expect(within(bar).queryByRole("link")).toBeNull();
    expect(within(bar).queryByRole("navigation")).toBeNull();
    expect(bar).toHaveTextContent(/^\[dialed\.run\]dialed\.run$/);
    expect(bar.querySelector(".text-title")).not.toBeNull();
  });
});
