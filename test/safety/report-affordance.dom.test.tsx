import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ReportAffordance } from "../../src/modules/safety/components/ReportAffordance";

type Props = Parameters<typeof ReportAffordance>[0];

/**
The foot link, whichever of its two wordings the subject gets.
*/
const REPORT = /^Report (this entry|or block )/u;

function renderAffordance(overrides: Partial<Props> = {}) {
  const fileReport: Props["fileReport"] = vi
    .fn<Props["fileReport"]>()
    .mockResolvedValue({});
  render(
    <ReportAffordance
      subject={{
        type: "entry",
        id: "e-1",
        label: "Tuesday shakeout",
        authorId: "author-1",
        authorName: "mark_t",
      }}
      viewerId="viewer-1"
      fileReport={fileReport}
      {...overrides}
    />,
  );
  return { fileReport };
}

/**
Whether the sheet's native <dialog> is currently open.
*/
function isSheetOpen(): boolean {
  return document.querySelector("dialog")?.open ?? false;
}

describe("who is offered a report control", () => {
  it("offers one to a signed-in stranger", () => {
    renderAffordance();
    expect(screen.getByRole("button", { name: REPORT })).toBeInTheDocument();
  });

  it("offers none to the author of the thing", () => {
    renderAffordance({ viewerId: "author-1" });
    // Reporting your own entry does nothing, and offering it reads as a
    // bug rather than a courtesy.
    expect(
      screen.queryByRole("button", { name: REPORT }),
    ).not.toBeInTheDocument();
  });

  it("offers none to someone signed out", () => {
    renderAffordance({ viewerId: undefined });
    // A signed-out reporter has no identity for the distinct-reporter
    // count to be counted against, and that count is the rule the whole
    // auto-hide threshold rests on.
    expect(
      screen.queryByRole("button", { name: REPORT }),
    ).not.toBeInTheDocument();
  });

  it("offers one on a subject with no author at all", () => {
    // A product name is UGC (D-26) and reportable, but has no single
    // author a runner would recognise.
    renderAffordance({
      subject: { type: "product", id: "p-1", label: "Some Shoe" },
    });
    expect(screen.getByRole("button", { name: REPORT })).toBeInTheDocument();
  });
});

describe("whether the block is offered alongside", () => {
  it("offers it when the subject IS a person", async () => {
    const user = userEvent.setup();
    renderAffordance({
      subject: {
        type: "profile",
        id: "author-1",
        label: "mark_t",
        authorId: "author-1",
        authorName: "mark_t",
      },
    });

    await user.click(screen.getByRole("button", { name: REPORT }));

    expect(
      screen.getByRole("checkbox", { name: "Block mark_t as well" }),
    ).toBeInTheDocument();
  });

  it("does not offer it on an entry", async () => {
    const user = userEvent.setup();
    renderAffordance();

    await user.click(screen.getByRole("button", { name: REPORT }));

    // An entry report names the entry, not its author. Blocking would
    // need a lookup the reporter never asked for — and `fileReport`
    // enforces the same rule on the write side.
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("does not offer it on a profile we can name but cannot identify", async () => {
    // **Named, and still not blockable.** Blocking needs the author's id;
    // a display name is not one. The subject carries the two as separate
    // optional props, so "we know what to call them" and "we know who
    // they are" can disagree, and only the second authorises a block.
    //
    // The name is what makes this test bite. Without it the sheet
    // withholds the checkbox anyway — it needs a name for the label —
    // so an affordance that had dropped the `authorId` check entirely
    // would still look correct here. That is not hypothetical: this test
    // used to pass a subject with neither field, and the mutation gate
    // caught it the moment the sheet started gating on the name too.
    const user = userEvent.setup();
    renderAffordance({
      subject: {
        type: "profile",
        id: "p-1",
        label: "A runner",
        authorName: "a_runner",
      },
    });

    await user.click(screen.getByRole("button", { name: REPORT }));

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});

describe("opening and closing", () => {
  it("keeps the sheet shut until asked", () => {
    renderAffordance();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("carries the subject into the report", async () => {
    const user = userEvent.setup();
    const { fileReport } = renderAffordance();

    await user.click(screen.getByRole("button", { name: REPORT }));
    await user.click(
      screen.getByRole("radio", { name: "It's an ad, or it's spam" }),
    );
    await user.click(screen.getByRole("button", { name: "Send report" }));

    const [call] = vi.mocked(fileReport).mock.calls;
    expect(call?.[0].data).toMatchObject({
      subjectType: "entry",
      subjectId: "e-1",
      reason: "spam",
    });
  });
});

describe("closing the sheet", () => {
  it("shuts when the reporter backs out", async () => {
    const user = userEvent.setup();
    renderAffordance();
    await user.click(screen.getByRole("button", { name: REPORT }));
    expect(isSheetOpen()).toBe(true);

    // `Sheet` is a native <dialog> and reports through its `close` event,
    // which is what Escape and the backdrop both raise in a browser.
    // happy-dom does not synthesise it from a key press, so the event
    // itself is what this drives.
    await act(async () => {
      document.querySelector("dialog")?.close();
      await Promise.resolve();
    });

    // A sheet that will not close traps the runner on a form they opened
    // by accident.
    await waitFor(() => {
      expect(isSheetOpen()).toBe(false);
    });

    // And it opens again. The dialog closing is the browser's doing; what
    // this proves is that the component heard about it — a handler that
    // never ran leaves `isOpen` true, and pressing Report changes nothing
    // because nothing changed.
    await user.click(screen.getByRole("button", { name: REPORT }));
    await waitFor(() => {
      expect(isSheetOpen()).toBe(true);
    });
  });

  it("shuts once the report has gone", async () => {
    const user = userEvent.setup();
    renderAffordance();
    await user.click(screen.getByRole("button", { name: REPORT }));

    await user.click(
      screen.getByRole("radio", { name: "It's an ad, or it's spam" }),
    );
    await user.click(screen.getByRole("button", { name: "Send report" }));

    // A sheet left up over a report that already went reads as a failure
    // and invites a second one.
    await waitFor(() => {
      expect(isSheetOpen()).toBe(false);
    });
  });
});

describe("the foot link (round 22, items 10, 12 and 21)", () => {
  it("reads Report this entry under an entry, as a small underlined link", () => {
    renderAffordance();
    const link = screen.getByRole("button", { name: "Report this entry" });
    expect(link).toHaveClass("text-small", "text-label", "underline");
  });

  it("names the runner, and the block, under a profile", () => {
    renderAffordance({
      subject: {
        type: "profile",
        id: "author-1",
        label: "mark_t",
        authorId: "author-1",
        authorName: "mark_t",
      },
    });
    expect(
      screen.getByRole("button", { name: "Report or block mark_t" }),
    ).toBeInTheDocument();
  });
});

describe("the sheet's close control (round 22, item 21)", () => {
  it("closes without asking and discards what was chosen", async () => {
    const user = userEvent.setup();
    const { fileReport } = renderAffordance();
    await user.click(screen.getByRole("button", { name: REPORT }));
    await user.click(
      screen.getByRole("radio", { name: "It's an ad, or it's spam" }),
    );
    await user.type(screen.getByLabelText(/Anything else/u), "spam link");

    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(isSheetOpen()).toBe(false);
    });
    expect(fileReport).not.toHaveBeenCalled();

    // Opened again, it is empty: nothing kept from the discarded report.
    await user.click(screen.getByRole("button", { name: REPORT }));
    await waitFor(() => {
      expect(isSheetOpen()).toBe(true);
    });
    expect(
      screen.getByRole("radio", { name: "It's an ad, or it's spam" }),
    ).not.toBeChecked();
    expect(screen.getByLabelText(/Anything else/u)).toHaveValue("");
  });
});
