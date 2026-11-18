import { createRef } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ControlRefusal } from "../../src/lib/control-refusal";
import { ConfirmLink, ConfirmSheet } from "../../src/ui/ConfirmSheet";

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

/**
 * A sheet's own text action (R55·214): centred in its 44 row at
 * TYPE.body in --quiet, the footer's third action rather than a footnote.
 */
describe("ConfirmLink's sheet tone", () => {
  it("is centred at TYPE.body in --quiet, underlined, in a 44 target", () => {
    render(
      <ConfirmLink
        label="Block without reporting"
        tone="sheet"
        heading="Block @mark_t?"
        body="Blocking hides all of @mark_t's runs from you."
        verb="Block"
        pendingVerb="Blocking"
        kicker="Not blocked"
        act={vi.fn(() => Promise.resolve())}
      />,
    );
    const link = screen.getByRole("button", {
      name: "Block without reporting",
    });
    expect(link).toHaveClass(
      "target",
      "cursor-pointer",
      "self-center",
      "border-none",
      "bg-transparent",
      "p-0",
      "text-body",
      "text-quiet",
      "underline",
      "underline-offset-4",
    );
    expect(link).not.toHaveClass("self-start", "text-small", "text-label");
  });
});

/**
 * The sheet's own buttons, under its header: the header's ✕ is also
 * named Close, and closes it the same way.
 */
function sheetBody() {
  const body = document.querySelector<HTMLElement>("[data-part=sheet]");
  if (body === null) throw new Error("no sheet open");
  return within(body);
}

function renderLink(act: () => Promise<unknown>) {
  render(
    <ConfirmLink
      label="Delete this entry"
      heading="Delete this entry?"
      body="This can't be undone."
      verb="Delete"
      pendingVerb="Deleting"
      kicker="Not deleted"
      act={act}
    />,
  );
}

/**
 * Round 60 (#820): a refusal pressing again cannot change — the held
 * delete — has no Try again, and the sheet's other button is Close. An
 * ordinary failure keeps both its Try again and Keep it.
 */
describe("a confirm the server refuses", () => {
  const HELD =
    "This kit is held while a copyright claim is settled, so it can't be deleted yet.";

  it("bands the refusal with no Try again, and offers Close beside Delete", async () => {
    const user = userEvent.setup();
    // The server's refusal, as the wire adapter rebuilds it.
    const act = vi.fn(() => Promise.reject(new ControlRefusal(HELD)));
    renderLink(act);

    await user.click(screen.getByRole("button", { name: "Delete this entry" }));
    await user.click(
      screen.getByRole("button", { name: "Delete", hidden: true }),
    );

    const band = await screen.findByText(HELD);
    expect(band.closest("[data-part=failure-band]")).toHaveTextContent(
      /Not deleted/u,
    );
    expect(
      screen.queryByRole("button", { name: "Try again", hidden: true }),
    ).toBeNull();
    expect(
      sheetBody().queryByRole("button", { name: "Keep it", hidden: true }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Delete", hidden: true }),
    ).toBeInTheDocument();

    await user.click(
      sheetBody().getByRole("button", { name: "Close", hidden: true }),
    );
    expect(
      screen.queryByRole("button", { name: "Delete", hidden: true }),
    ).toBeNull();
  });

  it("keeps Try again and Keep it for a failure a retry can fix", async () => {
    const user = userEvent.setup();
    const act = vi.fn(() => Promise.reject(new Error("boom")));
    renderLink(act);

    await user.click(screen.getByRole("button", { name: "Delete this entry" }));
    await user.click(
      screen.getByRole("button", { name: "Delete", hidden: true }),
    );

    const retry = await screen.findByRole("button", {
      name: "Try again",
      hidden: true,
    });
    expect(
      sheetBody().getByRole("button", { name: "Keep it", hidden: true }),
    ).toBeInTheDocument();
    expect(
      sheetBody().queryByRole("button", { name: "Close", hidden: true }),
    ).toBeNull();

    await user.click(retry);
    expect(act).toHaveBeenCalledTimes(2);
  });
});
