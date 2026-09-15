import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { reportReasons } from "../../src/modules/safety/contracts";
import { ReportSheet } from "../../src/modules/safety/components/ReportSheet";

type SheetProps = Parameters<typeof ReportSheet>[0];

/**
 * A subject with nobody to name — a product, say.
 */
const anonymousSubject: SheetProps["subject"] = {
  type: "product",
  id: "p-1",
  label: "Some Shoe",
};

function renderSheet(overrides: Partial<SheetProps> = {}) {
  // Typed rather than a bare `vi.fn()`: an untyped mock makes every
  // assertion against it an `any`, which the lint rules reject and which
  // would also let a wrong call shape pass unnoticed.
  const fileReport: SheetProps["fileReport"] = vi
    .fn<SheetProps["fileReport"]>()
    .mockResolvedValue({ reporterCount: 1 });
  const onFiled = vi.fn();
  const onClose = vi.fn();
  render(
    <ReportSheet
      open
      onClose={onClose}
      subject={{
        type: "entry",
        id: "01HZZZZZZZZZZZZZZZZZZZZZZZ",
        label: "mark_t · yesterday",
        authorName: "mark_t",
      }}
      canBlock
      fileReport={fileReport}
      onFiled={onFiled}
      {...overrides}
    />,
  );
  return { fileReport, onFiled, onClose };
}

describe("W1's reasons", () => {
  it("offers the artboard's sentences, not policy categories", () => {
    renderSheet();

    // The exact copy, because W1's own note is that these are "sentences a
    // runner would say". A rewrite into `sexual_content` / `harassment` /
    // `spam` would be inventing design language on a designed surface.
    expect(
      screen.getByRole("radio", {
        name: "The photo shows someone inappropriately",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: "This isn't their run or their gear" }),
    ).toBeInTheDocument();
  });

  it("offers every reason the contract defines", () => {
    renderSheet();
    // Derived from the table rather than a second list here: a reason
    // added to `reportReasons` and not to the sheet would otherwise be a
    // silent gap.
    expect(screen.getAllByRole("radio")).toHaveLength(reportReasons.length);
  });
});

describe("what the sheet promises", () => {
  it("tells the reporter what happens next, in the artboard's words", () => {
    renderSheet();

    // Each sentence is a promise the code keeps, so the copy is pinned:
    // a person reads it, the entry goes from your feed immediately, and
    // the author is never told who reported them.
    expect(screen.getByText(/A person reads it within a day/)).toBeInTheDocument();
    expect(
      screen.getByText(/hidden from your feed straight away/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/never told who\s+reported it/),
    ).toBeInTheDocument();
  });

  it("names the author in the block option", () => {
    renderSheet();
    expect(
      screen.getByRole("checkbox", { name: "Block mark_t as well" }),
    ).toBeInTheDocument();
  });

  it("does not offer a block when there is nobody to block", () => {
    renderSheet({ canBlock: false, subject: anonymousSubject });
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("avoids inventing a name when the subject has no author", () => {
    renderSheet({ subject: anonymousSubject, canBlock: false });
    // "them", not an empty gap where a handle would be.
    expect(screen.getByText(/them is never told/)).toBeInTheDocument();
  });
});

describe("filing a report", () => {
  it("sends the chosen reason and closes", async () => {
    const user = userEvent.setup();
    const { fileReport, onFiled, onClose } = renderSheet();

    await user.click(
      screen.getByRole("radio", { name: "It's an ad, or it's spam" }),
    );
    await user.click(screen.getByRole("button", { name: "Send report" }));

    // onSuccess runs after the action resolves, so the callbacks are part
    // of what we wait for rather than something to assert straight after.
    await waitFor(() => {
      expect(onFiled).toHaveBeenCalled();
    });
    // Reading the recorded argument rather than `expect.objectContaining`,
    // which is typed `any` and would let a wrong call shape through.
    const [call] = vi.mocked(fileReport).mock.calls;
    expect(call?.[0].data).toMatchObject({
      subjectType: "entry",
      subjectId: "01HZZZZZZZZZZZZZZZZZZZZZZZ",
      reason: "spam",
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("carries the block choice with the report rather than separately", async () => {
    const user = userEvent.setup();
    const { fileReport } = renderSheet();

    await user.click(
      screen.getByRole("radio", { name: "Harassment aimed at someone" }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: "Block mark_t as well" }),
    );
    await user.click(screen.getByRole("button", { name: "Send report" }));

    // One call, not two. A reporter who ticked the box and lost a second
    // request would be told the report worked while the block silently
    // did not.
    await waitFor(() => {
      expect(fileReport).toHaveBeenCalledTimes(1);
    });
    const [call] = vi.mocked(fileReport).mock.calls;
    expect(call?.[0].data).toMatchObject({
      alsoBlock: true,
      reason: "harassment",
    });
  });

  it("refuses to send without a reason, and says so", async () => {
    const user = userEvent.setup();
    const { fileReport } = renderSheet();

    await user.click(screen.getByRole("button", { name: "Send report" }));

    // The schema's own sentence, not zod's default — which would read
    // "Invalid option: expected one of \"explicit\"|\"harassment\"…" and
    // leak the stored values onto a sheet whose words are meant to be the
    // runner's. One missing field shows the field's message rather than
    // the summary, which deliberately stays quiet under two errors.
    await waitFor(() => {
      expect(screen.getByText("Pick what's wrong with it.")).toBeInTheDocument();
    });
    expect(fileReport).not.toHaveBeenCalled();
  });

  it("never disables the submit button", async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.click(screen.getByRole("radio", { name: "Something else" }));
    const button = screen.getByRole("button", { name: /Send report|Sending/ });

    // The forms contract: `disabled` drops focus and stops announcing, so
    // the guard is aria-disabled plus a handler-level double-submit check.
    expect(button).not.toBeDisabled();
  });
});
