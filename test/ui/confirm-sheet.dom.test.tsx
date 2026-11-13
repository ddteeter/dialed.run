import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConfirmSheet } from "../../src/ui/ConfirmSheet";

/**
 * The confirm's two buttons (R54·164.2, 167.1): the verb as the ink pill
 * and Keep it as the hairline pill, each a 44 target, full drawer width.
 */
describe("ConfirmSheet's buttons", () => {
  it("draws the verb as the ink pill and Keep it as the hairline pill, both targets", () => {
    render(
      <ConfirmSheet
        open
        heading="Delete this run?"
        body="This can't be undone."
        verb="Delete"
        pendingVerb="Deleting"
        action={{
          pending: false,
          failure: undefined,
          status: "",
          run: vi.fn(() => Promise.resolve()),
          retry: vi.fn(),
          retryRef: createRef(),
        }}
        onClose={vi.fn()}
      />,
    );
    const verb = screen.getByRole("button", { name: "Delete", hidden: true });
    expect(verb).toHaveClass(
      "target",
      "rounded-pill",
      "bg-ink",
      "text-ground",
      "min-h-control",
      "wide:in-data-[slot=sheet]:w-full",
    );
    const keep = screen.getByRole("button", { name: "Keep it", hidden: true });
    expect(keep).toHaveClass(
      "target",
      "rounded-pill",
      "border",
      "border-hairline",
      "bg-transparent",
      "min-h-control",
      "wide:in-data-[slot=sheet]:w-full",
    );
    expect(keep).not.toHaveClass("bg-ink");
  });
});
